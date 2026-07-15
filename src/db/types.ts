import type { AgentRunStatus } from "../agents/types.js";
import type { ProjectConfig } from "../config/schema.js";

/** A project row scoped to a tenant (organization) and guild. */
export interface StoredProject extends ProjectConfig {
  orgId: string;
}

export interface Organization {
  id: string;
  name: string;
}

export interface GuildInstallation {
  orgId: string;
  guildId: string;
}

/** Encrypted BYOK credential envelope. Ciphertext never leaves the server. */
export interface ProviderCredential {
  orgId: string;
  providerId: string;
  ciphertext: string;
  iv: string;
  keyVersion: number;
  baseUrl?: string;
}

/** Maps a Discord context (channel/thread) + project + provider to an agent. */
export interface ContextAgent {
  orgId: string;
  contextId: string;
  projectName: string;
  providerId: string;
  agentId: string;
  guildId: string;
  routeChannelId: string;
}

export interface StoredRun {
  orgId: string;
  runId: string;
  providerId: string;
  agentId: string;
  contextId: string;
  projectName: string;
  userId: string;
  discordChannelId: string;
  discordMessageId: string | null;
  status: AgentRunStatus;
  result: string | null;
  prUrl: string | null;
  workflowId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewRun {
  orgId: string;
  runId: string;
  providerId: string;
  agentId: string;
  contextId: string;
  projectName: string;
  userId: string;
  discordChannelId: string;
  status: AgentRunStatus;
}

/**
 * Persistence contract used by the Worker and Workflow. A Supabase-backed
 * implementation runs in production; an in-memory implementation backs tests so
 * tenant isolation, rate limiting, idempotency, and concurrency can be verified
 * without a live database.
 */
export interface DataStore {
  // Tenancy & configuration.
  getInstallationByGuild(guildId: string): Promise<GuildInstallation | null>;
  listProjectsByGuild(guildId: string): Promise<StoredProject[]>;
  getProject(orgId: string, name: string): Promise<StoredProject | null>;

  // Credentials (BYOK).
  getProviderCredential(
    orgId: string,
    providerId: string,
  ): Promise<ProviderCredential | null>;

  // Context <-> agent mapping.
  getContextAgent(
    orgId: string,
    contextId: string,
    projectName: string,
    providerId: string,
  ): Promise<ContextAgent | null>;
  setContextAgent(record: ContextAgent): Promise<void>;

  // Runs.
  saveRun(run: NewRun): Promise<void>;
  setRunMessage(
    orgId: string,
    runId: string,
    channelId: string,
    messageId: string,
  ): Promise<void>;
  setRunWorkflowId(
    orgId: string,
    runId: string,
    workflowId: string,
  ): Promise<void>;
  updateRun(
    orgId: string,
    runId: string,
    status: AgentRunStatus,
    result: string | null,
    prUrl: string | null,
  ): Promise<void>;
  getRun(orgId: string, runId: string): Promise<StoredRun | null>;
  listRunsForContext(orgId: string, contextId: string): Promise<StoredRun[]>;

  // Rate limiting (per user, per window). Atomically counts recent starts and,
  // if under the limit, records a new start. Returns true when the start is
  // allowed and was recorded.
  tryRecordStart(
    orgId: string,
    userId: string,
    guildId: string,
    projectName: string,
    windowMs: number,
    maxPerWindow: number,
  ): Promise<boolean>;

  // Idempotency: returns true only the first time an interaction id is seen.
  markInteractionProcessed(interactionId: string): Promise<boolean>;

  // Per-context concurrency lock. Returns true if the lock was acquired.
  acquireContextLock(
    orgId: string,
    contextId: string,
    projectName: string,
    expiresAtMs: number,
  ): Promise<boolean>;
  // Releasing with `expectedExpiresAtMs` only removes the lock if it still holds
  // that exact expiry, which acts as an ownership token: a workflow won't
  // release a lock a newer run has since re-acquired. Omit it to force-release
  // (used by the cancel command to unstick a channel).
  releaseContextLock(
    orgId: string,
    contextId: string,
    projectName: string,
    expectedExpiresAtMs?: number,
  ): Promise<void>;
}
