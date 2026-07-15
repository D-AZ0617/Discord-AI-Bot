import { CursorClient } from "../../cursor/client.js";
import { cursorErrorForDiscord } from "../../cursor/errors.js";
import type { DecryptedCredential, ProviderDefinition } from "../registry.js";
import type {
  AgentProvider,
  AgentRun,
  CreateAgentInput,
  CreatedAgent,
} from "../types.js";

export class CursorAgentProvider implements AgentProvider {
  readonly id = "cursor";
  readonly displayName = "Cursor Cloud Agents";
  readonly capabilities = {
    durableAgents: true,
    repositoryAccess: true,
    pullRequests: true,
  } as const;

  constructor(private readonly client: CursorClient) {}

  async createAgent(input: CreateAgentInput): Promise<CreatedAgent> {
    return this.client.createAgent({
      prompt: input.prompt,
      repoUrl: input.repoUrl,
      ...(input.defaultBranch ? { defaultBranch: input.defaultBranch } : {}),
      ...(input.name ? { name: input.name } : {}),
      autoCreatePR: input.autoCreatePR,
    });
  }

  createRun(agentId: string, prompt: string): Promise<AgentRun> {
    return this.client.createRun(agentId, prompt);
  }

  getRun(agentId: string, runId: string): Promise<AgentRun> {
    return this.client.getRun(agentId, runId);
  }

  agentUrl(agentId: string): string {
    return `https://cursor.com/agents/${agentId}`;
  }

  errorForUser(error: unknown): string {
    return cursorErrorForDiscord(error);
  }

  verifyCredential(): Promise<void> {
    return this.client.verifyKey();
  }
}

/** Definition registered in the provider registry. */
export const cursorProviderDefinition: ProviderDefinition = {
  id: "cursor",
  displayName: "Cursor Cloud Agents",
  capabilities: {
    durableAgents: true,
    repositoryAccess: true,
    pullRequests: true,
  },
  create(credential: DecryptedCredential): AgentProvider {
    const client = credential.baseUrl
      ? new CursorClient(credential.apiKey, credential.baseUrl)
      : new CursorClient(credential.apiKey);
    return new CursorAgentProvider(client);
  },
};
