import { CursorApiError } from "./errors.js";
import type { AgentRun, AgentRunStatus } from "../agents/types.js";

export type CursorRunStatus = AgentRunStatus;

export interface CursorRun extends AgentRun {}

export interface CreatedAgent {
  agent: {
    id: string;
    name: string;
    status: string;
    url?: string;
    latestRunId: string;
  };
  run: CursorRun;
}

export class CursorClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.cursor.com",
  ) {}

  async createAgent(input: {
    prompt: string;
    repoUrl: string;
    defaultBranch?: string;
    name?: string;
    autoCreatePR: boolean;
  }): Promise<CreatedAgent> {
    return this.request<CreatedAgent>("/v1/agents", {
      method: "POST",
      body: JSON.stringify({
        prompt: { text: input.prompt },
        ...(input.name ? { name: input.name.slice(0, 100) } : {}),
        repos: [
          {
            url: input.repoUrl,
            ...(input.defaultBranch ? { startingRef: input.defaultBranch } : {}),
          },
        ],
        workOnCurrentBranch: false,
        autoCreatePR: input.autoCreatePR,
        skipReviewerRequest: true,
        mode: "agent",
      }),
    });
  }

  async createRun(agentId: string, prompt: string): Promise<CursorRun> {
    const response = await this.request<{ run: CursorRun }>(
      `/v1/agents/${encodeURIComponent(agentId)}/runs`,
      {
        method: "POST",
        body: JSON.stringify({ prompt: { text: prompt } }),
      },
    );
    return response.run;
  }

  getRun(agentId: string, runId: string): Promise<CursorRun> {
    return this.request<CursorRun>(
      `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
    );
  }

  async verifyKey(): Promise<void> {
    await this.request<unknown>("/v1/me");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CursorApiError(`Network error: ${message}`, 0, undefined, true);
    }

    if (!response.ok) {
      const payload = await readErrorPayload(response);
      throw new CursorApiError(
        payload.message ?? `HTTP ${response.status}`,
        response.status,
        payload.code,
        response.status === 429 || response.status >= 500,
      );
    }
    return (await response.json()) as T;
  }
}

async function readErrorPayload(
  response: Response,
): Promise<{ code?: string; message?: string }> {
  try {
    const value = (await response.json()) as Record<string, unknown>;
    const nested =
      typeof value.error === "object" && value.error !== null
        ? (value.error as Record<string, unknown>)
        : value;
    return {
      ...(typeof nested.code === "string" ? { code: nested.code } : {}),
      ...(typeof nested.message === "string"
        ? { message: nested.message.slice(0, 500) }
        : {}),
    };
  } catch {
    return {};
  }
}

