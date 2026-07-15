import type { DecryptedCredential, ProviderDefinition } from "../registry.js";
import type {
  AgentProvider,
  AgentRun,
  CreateAgentInput,
  CreatedAgent,
} from "../types.js";

/**
 * Chat providers answer a prompt with a single LLM completion. Unlike the
 * repo-oriented Cursor provider, they don't clone a repository, open pull
 * requests, or keep durable server-side sessions — each prompt is one request.
 * They still implement {@link AgentProvider} so the same command flow, rate
 * limits, and status messages work for them.
 */

class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

interface ChatBackend {
  id: string;
  displayName: string;
  suggestedModels: string[];
  defaultModel: string;
  apiKeyHint: string;
  complete(
    credential: DecryptedCredential,
    model: string,
    prompt: string,
  ): Promise<string>;
  verify(credential: DecryptedCredential): Promise<void>;
}

async function httpJson(
  url: string,
  init: RequestInit,
  action: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ChatError(`Network error: ${message}`, 0, true);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ChatError(
      `${action} failed: HTTP ${response.status} ${body.slice(0, 300)}`,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
  return response.json();
}

function requireText(value: string | undefined | null, provider: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new ChatError(`${provider} returned an empty response.`, 0, false);
  return text;
}

/** OpenAI-compatible Chat Completions (OpenAI and OpenRouter). */
function openAiCompatible(config: {
  id: string;
  displayName: string;
  baseUrl: string;
  suggestedModels: string[];
  defaultModel: string;
  apiKeyHint: string;
  extraHeaders?: Record<string, string>;
}): ChatBackend {
  const base = config.baseUrl;
  return {
    id: config.id,
    displayName: config.displayName,
    suggestedModels: config.suggestedModels,
    defaultModel: config.defaultModel,
    apiKeyHint: config.apiKeyHint,
    async complete(credential, model, prompt) {
      const data = (await httpJson(
        `${credential.baseUrl ?? base}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.apiKey}`,
            "content-type": "application/json",
            ...config.extraHeaders,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
          }),
        },
        config.displayName,
      )) as { choices?: Array<{ message?: { content?: string } }> };
      return requireText(data.choices?.[0]?.message?.content, config.displayName);
    },
    async verify(credential) {
      await httpJson(
        `${credential.baseUrl ?? base}/models`,
        {
          headers: {
            authorization: `Bearer ${credential.apiKey}`,
            ...config.extraHeaders,
          },
        },
        `${config.displayName} auth`,
      );
    },
  };
}

const openaiBackend = openAiCompatible({
  id: "openai",
  displayName: "OpenAI (ChatGPT)",
  baseUrl: "https://api.openai.com/v1",
  defaultModel: "gpt-4o-mini",
  suggestedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  apiKeyHint: "platform.openai.com → API keys",
});

const openrouterBackend = openAiCompatible({
  id: "openrouter",
  displayName: "OpenRouter (free models)",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel: "openrouter/free",
  suggestedModels: [
    "openrouter/free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "qwen/qwen3-coder:free",
    "openai/gpt-oss-20b:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  apiKeyHint: "openrouter.ai → Keys (many models are free)",
  extraHeaders: {
    "HTTP-Referer": "https://discord-agent-bot.d-az0617.workers.dev",
    "X-Title": "Relay",
  },
});

const anthropicBackend: ChatBackend = {
  id: "anthropic",
  displayName: "Anthropic (Claude)",
  defaultModel: "claude-3-5-haiku-latest",
  suggestedModels: [
    "claude-3-5-haiku-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-7-sonnet-latest",
    "claude-sonnet-4-0",
  ],
  apiKeyHint: "console.anthropic.com → API keys",
  async complete(credential, model, prompt) {
    const data = (await httpJson(
      `${credential.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": credential.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        }),
      },
      "Anthropic (Claude)",
    )) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((block) => block.type === "text")?.text;
    return requireText(text, "Anthropic (Claude)");
  },
  async verify(credential) {
    await httpJson(
      `${credential.baseUrl ?? "https://api.anthropic.com"}/v1/models`,
      {
        headers: {
          "x-api-key": credential.apiKey,
          "anthropic-version": "2023-06-01",
        },
      },
      "Anthropic auth",
    );
  },
};

const geminiBackend: ChatBackend = {
  id: "google",
  displayName: "Google Gemini",
  defaultModel: "gemini-2.0-flash",
  suggestedModels: [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ],
  apiKeyHint: "aistudio.google.com → Get API key",
  async complete(credential, model, prompt) {
    const base = credential.baseUrl ?? "https://generativelanguage.googleapis.com";
    const data = (await httpJson(
      `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(credential.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
      "Google Gemini",
    )) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("");
    return requireText(text, "Google Gemini");
  },
  async verify(credential) {
    const base = credential.baseUrl ?? "https://generativelanguage.googleapis.com";
    await httpJson(
      `${base}/v1beta/models?key=${encodeURIComponent(credential.apiKey)}`,
      {},
      "Google Gemini auth",
    );
  },
};

class ChatAgentProvider implements AgentProvider {
  readonly capabilities = {
    durableAgents: false,
    repositoryAccess: false,
    pullRequests: false,
  } as const;

  constructor(
    private readonly backend: ChatBackend,
    private readonly credential: DecryptedCredential,
  ) {}

  get id(): string {
    return this.backend.id;
  }
  get displayName(): string {
    return this.backend.displayName;
  }

  private modelFrom(providerOptions?: Readonly<Record<string, unknown>>): string {
    const model = providerOptions?.model;
    return typeof model === "string" && model.trim()
      ? model.trim()
      : this.backend.defaultModel;
  }

  private makeRun(result: string): AgentRun {
    const now = new Date().toISOString();
    return {
      id: `run-${crypto.randomUUID()}`,
      agentId: `chat-${crypto.randomUUID()}`,
      status: "FINISHED",
      createdAt: now,
      updatedAt: now,
      result,
    };
  }

  async createAgent(input: CreateAgentInput): Promise<CreatedAgent> {
    const model = this.modelFrom(input.providerOptions);
    const result = await this.backend.complete(this.credential, model, input.prompt);
    const run = this.makeRun(result);
    return { agent: { id: run.agentId, name: input.name ?? this.displayName }, run };
  }

  async createRun(
    _agentId: string,
    prompt: string,
    providerOptions?: Readonly<Record<string, unknown>>,
  ): Promise<AgentRun> {
    const model = this.modelFrom(providerOptions);
    const result = await this.backend.complete(this.credential, model, prompt);
    return this.makeRun(result);
  }

  async getRun(agentId: string, runId: string): Promise<AgentRun> {
    // Chat responses are returned synchronously, so nothing is polled. Return a
    // terminal run defensively in case this is ever called.
    const now = new Date().toISOString();
    return {
      id: runId,
      agentId,
      status: "FINISHED",
      createdAt: now,
      updatedAt: now,
    };
  }

  agentUrl(): string | undefined {
    return undefined;
  }

  errorForUser(error: unknown): string {
    if (error instanceof ChatError) {
      if (error.status === 401 || error.status === 403) {
        return `${this.displayName} authentication failed. An administrator should check the API key.`;
      }
      if (error.status === 429) {
        return `${this.displayName} rate limit or quota was reached. Try again shortly.`;
      }
      if (error.status === 404) {
        return `${this.displayName} could not find that model. Check the model name in the project settings.`;
      }
      if (error.status >= 500) {
        return `${this.displayName} is temporarily unavailable. Please try again.`;
      }
      return `${this.displayName} rejected the request: ${error.message}`;
    }
    return `${this.displayName} could not be reached. Please try again.`;
  }

  verifyCredential(): Promise<void> {
    return this.backend.verify(this.credential);
  }
}

function definitionFor(backend: ChatBackend): ProviderDefinition {
  return {
    id: backend.id,
    displayName: backend.displayName,
    kind: "chat",
    suggestedModels: backend.suggestedModels,
    apiKeyHint: backend.apiKeyHint,
    capabilities: {
      durableAgents: false,
      repositoryAccess: false,
      pullRequests: false,
    },
    create: (credential) => new ChatAgentProvider(backend, credential),
  };
}

export const chatProviderDefinitions: ProviderDefinition[] = [
  definitionFor(openaiBackend),
  definitionFor(anthropicBackend),
  definitionFor(geminiBackend),
  definitionFor(openrouterBackend),
];
