export type AgentRunStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export interface AgentRun {
  id: string;
  agentId: string;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  durationMs?: number;
  result?: string;
  git?: {
    branches: Array<{
      repoUrl: string;
      branch?: string;
      prUrl?: string;
    }>;
  };
}

export interface CreatedAgent {
  agent: {
    id: string;
    name: string;
    url?: string;
  };
  run: AgentRun;
}

export interface CreateAgentInput {
  prompt: string;
  repoUrl: string;
  defaultBranch?: string;
  name?: string;
  autoCreatePR: boolean;
  providerOptions: Readonly<Record<string, unknown>>;
}

export interface AgentProviderCapabilities {
  durableAgents: boolean;
  repositoryAccess: boolean;
  pullRequests: boolean;
}

export interface AgentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: AgentProviderCapabilities;

  createAgent(input: CreateAgentInput): Promise<CreatedAgent>;
  createRun(agentId: string, prompt: string): Promise<AgentRun>;
  getRun(agentId: string, runId: string): Promise<AgentRun>;
  agentUrl(agentId: string): string | undefined;
  errorForUser(error: unknown): string;
  /** Optionally verify the configured credential (used by the dashboard). */
  verifyCredential?(): Promise<void>;
}

export function isTerminalStatus(status: AgentRunStatus): boolean {
  return (
    status === "FINISHED" ||
    status === "ERROR" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  );
}
