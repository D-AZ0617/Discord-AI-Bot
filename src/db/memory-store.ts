import type { AgentRunStatus } from "../agents/types.js";
import type {
  ContextAgent,
  DataStore,
  GuildInstallation,
  NewRun,
  Organization,
  ProviderCredential,
  StoredProject,
  StoredRun,
} from "./types.js";

interface StartRow {
  orgId: string;
  userId: string;
  createdAt: number;
}

/**
 * In-memory {@link DataStore} used by tests. Enforces the same tenant scoping,
 * idempotency, rate-limit, and locking semantics as the Supabase store so those
 * guarantees can be verified deterministically without a live database.
 */
export class InMemoryStore implements DataStore {
  readonly organizations = new Map<string, Organization>();
  private readonly installations = new Map<string, GuildInstallation>();
  private readonly projects: StoredProject[] = [];
  private readonly credentials = new Map<string, ProviderCredential>();
  private readonly contextAgents = new Map<string, ContextAgent>();
  private readonly runs = new Map<string, StoredRun>();
  private readonly starts: StartRow[] = [];
  private readonly processed = new Set<string>();
  private readonly locks = new Map<string, number>();

  seedOrganization(org: Organization): void {
    this.organizations.set(org.id, org);
  }
  seedInstallation(install: GuildInstallation): void {
    this.installations.set(install.guildId, install);
  }
  seedProject(project: StoredProject): void {
    this.projects.push(project);
  }
  seedCredential(credential: ProviderCredential): void {
    this.credentials.set(`${credential.orgId}:${credential.providerId}`, credential);
  }

  async getInstallationByGuild(
    guildId: string,
  ): Promise<GuildInstallation | null> {
    return this.installations.get(guildId) ?? null;
  }

  async listProjectsByGuild(guildId: string): Promise<StoredProject[]> {
    return this.projects.filter((project) => project.guildId === guildId);
  }

  async getProject(orgId: string, name: string): Promise<StoredProject | null> {
    return (
      this.projects.find((p) => p.orgId === orgId && p.name === name) ?? null
    );
  }

  async getProviderCredential(
    orgId: string,
    providerId: string,
  ): Promise<ProviderCredential | null> {
    return this.credentials.get(`${orgId}:${providerId}`) ?? null;
  }

  private agentKey(
    orgId: string,
    contextId: string,
    projectName: string,
    providerId: string,
  ): string {
    return `${orgId}:${contextId}:${projectName}:${providerId}`;
  }

  async getContextAgent(
    orgId: string,
    contextId: string,
    projectName: string,
    providerId: string,
  ): Promise<ContextAgent | null> {
    return (
      this.contextAgents.get(
        this.agentKey(orgId, contextId, projectName, providerId),
      ) ?? null
    );
  }

  async setContextAgent(record: ContextAgent): Promise<void> {
    this.contextAgents.set(
      this.agentKey(
        record.orgId,
        record.contextId,
        record.projectName,
        record.providerId,
      ),
      record,
    );
  }

  private runKey(orgId: string, runId: string): string {
    return `${orgId}:${runId}`;
  }

  async saveRun(run: NewRun): Promise<void> {
    const now = Date.now();
    this.runs.set(this.runKey(run.orgId, run.runId), {
      ...run,
      discordMessageId: null,
      result: null,
      prUrl: null,
      workflowId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async setRunMessage(
    orgId: string,
    runId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const run = this.runs.get(this.runKey(orgId, runId));
    if (run) {
      run.discordChannelId = channelId;
      run.discordMessageId = messageId;
    }
  }

  async setRunWorkflowId(
    orgId: string,
    runId: string,
    workflowId: string,
  ): Promise<void> {
    const run = this.runs.get(this.runKey(orgId, runId));
    if (run) run.workflowId = workflowId;
  }

  async updateRun(
    orgId: string,
    runId: string,
    status: AgentRunStatus,
    result: string | null,
    prUrl: string | null,
  ): Promise<void> {
    const run = this.runs.get(this.runKey(orgId, runId));
    if (run) {
      run.status = status;
      run.result = result;
      run.prUrl = prUrl;
      run.updatedAt = Date.now();
    }
  }

  async getRun(orgId: string, runId: string): Promise<StoredRun | null> {
    return this.runs.get(this.runKey(orgId, runId)) ?? null;
  }

  async listRunsForContext(
    orgId: string,
    contextId: string,
  ): Promise<StoredRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.orgId === orgId && run.contextId === contextId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async tryRecordStart(
    orgId: string,
    userId: string,
    _guildId: string,
    _projectName: string,
    windowMs: number,
    maxPerWindow: number,
  ): Promise<boolean> {
    const since = Date.now() - windowMs;
    const used = this.starts.filter(
      (row) =>
        row.orgId === orgId && row.userId === userId && row.createdAt >= since,
    ).length;
    if (used >= maxPerWindow) return false;
    this.starts.push({ orgId, userId, createdAt: Date.now() });
    return true;
  }

  async markInteractionProcessed(interactionId: string): Promise<boolean> {
    if (this.processed.has(interactionId)) return false;
    this.processed.add(interactionId);
    return true;
  }

  private lockKey(orgId: string, contextId: string, projectName: string): string {
    return `${orgId}:${contextId}:${projectName}`;
  }

  async acquireContextLock(
    orgId: string,
    contextId: string,
    projectName: string,
    expiresAtMs: number,
  ): Promise<boolean> {
    const key = this.lockKey(orgId, contextId, projectName);
    const existing = this.locks.get(key);
    if (existing !== undefined && existing > Date.now()) return false;
    this.locks.set(key, expiresAtMs);
    return true;
  }

  async releaseContextLock(
    orgId: string,
    contextId: string,
    projectName: string,
    expectedExpiresAtMs?: number,
  ): Promise<void> {
    const key = this.lockKey(orgId, contextId, projectName);
    if (
      expectedExpiresAtMs !== undefined &&
      this.locks.get(key) !== expectedExpiresAtMs
    ) {
      return;
    }
    this.locks.delete(key);
  }
}
