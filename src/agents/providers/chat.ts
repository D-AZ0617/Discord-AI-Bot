import type {
  DecryptedCredential,
  ProviderDefinition,
  ProviderKind,
} from "../registry.js";
import type {
  AgentProvider,
  AgentProviderCapabilities,
  AgentRun,
  CreateAgentInput,
  CreatedAgent,
} from "../types.js";
import {
  CODE_CHAT_COMMIT_REFRESH_MS,
  readCodeChatCache,
  snapshotFromCache,
  writeCodeChatCache,
} from "../../codebase/context-cache.js";
import {
  CODE_CHAT_SYSTEM_PROMPT,
  FILE_PICK_SYSTEM_PROMPT,
  fetchRecentCommitsDetailed,
  fetchSelectedFiles,
  formatFilesForPrompt,
  formatTreeForPrompt,
  GitHubContextError,
  loadRepoSnapshot,
  mergeFetchedFiles,
  mergePathPicks,
  pickPathsFromModelReply,
  repoUrlForSnapshot,
  suggestPathsForQuestion,
} from "../../codebase/github-context.js";

/**
 * Chat providers answer a prompt with a single LLM completion. OpenRouter is
 * available as chat (`openrouter`) or read-only codebase Q&A (`openrouter-code`).
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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
    messages: ChatMessage[],
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

function userPrompt(prompt: string): ChatMessage[] {
  return [{ role: "user", content: prompt }];
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
    async complete(credential, model, messages) {
      const data = (await httpJson(
        `${credential.baseUrl ?? base}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.apiKey}`,
            "content-type": "application/json",
            ...config.extraHeaders,
          },
          body: JSON.stringify({ model, messages }),
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

const openrouterModels = [
    "openrouter/free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "qwen/qwen3-coder:free",
    "openai/gpt-oss-20b:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
  ];

const openrouterBackend = openAiCompatible({
  id: "openrouter",
  displayName: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel: "openrouter/free",
  suggestedModels: openrouterModels,
  apiKeyHint: "openrouter.ai → Keys (many models are free)",
  extraHeaders: {
    "HTTP-Referer": "https://discord-agent-bot.d-az0617.workers.dev",
    "X-Title": "Relay",
  },
});

const openrouterCodeBackend = openAiCompatible({
  id: "openrouter-code",
  displayName: "OpenRouter (codebase)",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel: "openrouter/free",
  suggestedModels: openrouterModels,
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
  async complete(credential, model, messages) {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const nonSystem = messages.filter((m) => m.role !== "system");
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
          ...(system ? { system } : {}),
          messages: nonSystem.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
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
  async complete(credential, model, messages) {
    const base = credential.baseUrl ?? "https://generativelanguage.googleapis.com";
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const data = (await httpJson(
      `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(credential.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(system
            ? { systemInstruction: { parts: [{ text: system }] } }
            : {}),
          contents,
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

abstract class BaseChatProvider implements AgentProvider {
  abstract readonly capabilities: AgentProviderCapabilities;

  constructor(
    protected readonly backend: ChatBackend,
    protected readonly credential: DecryptedCredential,
  ) {}

  get id(): string {
    return this.backend.id;
  }
  get displayName(): string {
    return this.backend.displayName;
  }

  protected modelFrom(providerOptions?: Readonly<Record<string, unknown>>): string {
    const model = providerOptions?.model;
    return typeof model === "string" && model.trim()
      ? model.trim()
      : this.backend.defaultModel;
  }

  protected makeRun(result: string): AgentRun {
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

  async createRun(
    _agentId: string,
    prompt: string,
    providerOptions?: Readonly<Record<string, unknown>>,
  ): Promise<AgentRun> {
    // Follow-ups for non-durable providers go through createAgent in the
    // workflow so repo context is preserved; this path stays for safety.
    const model = this.modelFrom(providerOptions);
    const result = await this.backend.complete(
      this.credential,
      model,
      userPrompt(prompt),
    );
    return this.makeRun(result);
  }

  async getRun(agentId: string, runId: string): Promise<AgentRun> {
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
    if (error instanceof GitHubContextError) {
      return error.message;
    }
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

  abstract createAgent(input: CreateAgentInput): Promise<CreatedAgent>;
}

class ChatAgentProvider extends BaseChatProvider {
  readonly capabilities = {
    durableAgents: false,
    repositoryAccess: false,
    pullRequests: false,
  } as const;

  async createAgent(input: CreateAgentInput): Promise<CreatedAgent> {
    const model = this.modelFrom(input.providerOptions);
    const result = await this.backend.complete(
      this.credential,
      model,
      userPrompt(input.prompt),
    );
    const run = this.makeRun(result);
    return { agent: { id: run.agentId, name: input.name ?? this.displayName }, run };
  }
}

/** Two-pass read-only Q&A over a public GitHub repo (OpenRouter coding). */
class CodeChatAgentProvider extends BaseChatProvider {
  readonly capabilities = {
    durableAgents: false,
    repositoryAccess: true,
    pullRequests: false,
  } as const;

  async createAgent(input: CreateAgentInput): Promise<CreatedAgent> {
    const repoUrl = input.repoUrl?.trim() ?? "";
    if (!repoUrl) {
      throw new ChatError(
        "This OpenRouter project has no GitHub repository URL saved in Relay. Open the dashboard → edit this OpenRouter project → set GitHub repo URL to https://github.com/owner/repo → click Update project. (Making the repo public on GitHub is not enough if the URL field is empty.)",
        0,
        false,
      );
    }

    const model = this.modelFrom(input.providerOptions);
    const cacheKey = input.contextCacheKey?.trim() || null;
    const cached = cacheKey ? await readCodeChatCache(cacheKey) : null;

    const snapshot =
      cached?.repoUrl === repoUrl &&
      (!input.defaultBranch?.trim() || cached.ref === input.defaultBranch.trim())
        ? snapshotFromCache(cached)
        : await loadRepoSnapshot(repoUrl, input.defaultBranch);

    const useCachedCommits =
      cached &&
      cached.repoUrl === repoUrl &&
      cached.ref === snapshot.ref &&
      Date.now() - cached.savedAt <= CODE_CHAT_COMMIT_REFRESH_MS;

    const commits = useCachedCommits
      ? cached.commits
      : await fetchRecentCommitsDetailed(
          snapshot.owner,
          snapshot.repo,
          snapshot.ref,
        );

    const treeText = formatTreeForPrompt(snapshot.treePaths);
    const repoLine = `Repository: ${repoUrlForSnapshot(snapshot)} (ref: ${snapshot.ref})`;
    const heuristicPaths = suggestPathsForQuestion(
      input.prompt,
      snapshot.treePaths,
    );

    let modelPaths: string[] = [];
    if (heuristicPaths.length < 4) {
      const pickReply = await this.backend.complete(this.credential, model, [
        { role: "system", content: FILE_PICK_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${repoLine}\n\nQuestion:\n${input.prompt}\n\nRepository file tree:\n${treeText}`,
        },
      ]);
      modelPaths = pickPathsFromModelReply(
        pickReply,
        new Set(snapshot.treePaths),
      );
    }

    const selected = mergePathPicks(heuristicPaths, modelPaths);
    const cachedFiles =
      cached?.repoUrl === repoUrl && cached.ref === snapshot.ref
        ? cached.files
        : [];
    const cachedPathSet = new Set(cachedFiles.map((file) => file.path));
    const pathsToFetch = selected.filter((path) => !cachedPathSet.has(path));
    const fetched = await fetchSelectedFiles(snapshot, pathsToFetch);
    const files = mergeFetchedFiles(cachedFiles, fetched, selected);
    const context = formatFilesForPrompt(snapshot, files, commits);

    if (cacheKey) {
      await writeCodeChatCache(cacheKey, {
        repoUrl,
        ref: snapshot.ref,
        treePaths: snapshot.treePaths,
        ...(snapshot.readme ? { readme: snapshot.readme } : {}),
        manifests: snapshot.manifests,
        commits,
        files,
        savedAt: Date.now(),
      });
    }

    const result = await this.backend.complete(this.credential, model, [
      { role: "system", content: CODE_CHAT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `${context}\n\n---\nUser question:\n${input.prompt}`,
      },
    ]);

    const run = this.makeRun(result);
    return { agent: { id: run.agentId, name: input.name ?? this.displayName }, run };
  }
}

function definitionFor(
  backend: ChatBackend,
  kind: ProviderKind,
  capabilities: AgentProviderCapabilities,
  factory: (credential: DecryptedCredential) => AgentProvider,
): ProviderDefinition {
  return {
    id: backend.id,
    displayName: backend.displayName,
    kind,
    suggestedModels: backend.suggestedModels,
    apiKeyHint: backend.apiKeyHint,
    capabilities,
    create: factory,
  };
}

export const chatProviderDefinitions: ProviderDefinition[] = [
  definitionFor(
    openaiBackend,
    "chat",
    { durableAgents: false, repositoryAccess: false, pullRequests: false },
    (credential) => new ChatAgentProvider(openaiBackend, credential),
  ),
  definitionFor(
    anthropicBackend,
    "chat",
    { durableAgents: false, repositoryAccess: false, pullRequests: false },
    (credential) => new ChatAgentProvider(anthropicBackend, credential),
  ),
  definitionFor(
    geminiBackend,
    "chat",
    { durableAgents: false, repositoryAccess: false, pullRequests: false },
    (credential) => new ChatAgentProvider(geminiBackend, credential),
  ),
  definitionFor(
    openrouterBackend,
    "chat",
    { durableAgents: false, repositoryAccess: false, pullRequests: false },
    (credential) => new ChatAgentProvider(openrouterBackend, credential),
  ),
  definitionFor(
    openrouterCodeBackend,
    "code-chat",
    { durableAgents: false, repositoryAccess: true, pullRequests: false },
    (credential) => new CodeChatAgentProvider(openrouterCodeBackend, credential),
  ),
];
