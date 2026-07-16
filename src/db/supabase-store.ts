import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import type { AgentRunStatus } from "../agents/types.js";
import { withChannelScope } from "../config/schema.js";
import type { AdminStore } from "./admin.js";
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

/**
 * Create a service-role Supabase client. The service role bypasses RLS, so this
 * client is only ever constructed server-side inside the Worker/Workflow and
 * never exposed to browsers.
 */
export function createServiceClient(env: Env): SupabaseClient {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing. For local dev, add it to .dev.vars (Supabase → Project Settings → API → service_role).",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface ProjectRow {
  org_id: string;
  guild_id: string;
  name: string;
  display_name: string | null;
  channel_ids: string[];
  allowed_role_ids: string[];
  provider: string;
  provider_options: Record<string, unknown> | null;
  repo_url: string;
  default_branch: string | null;
  auto_create_pr: boolean;
}

function toProject(row: ProjectRow): StoredProject {
  return withChannelScope({
    orgId: row.org_id,
    guildId: row.guild_id,
    name: row.name,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    channelIds: row.channel_ids ?? [],
    allowedRoleIds: row.allowed_role_ids ?? [],
    provider: row.provider,
    providerOptions: row.provider_options ?? {},
    repoUrl: row.repo_url,
    ...(row.default_branch ? { defaultBranch: row.default_branch } : {}),
    autoCreatePR: row.auto_create_pr,
  });
}

export class SupabaseStore implements DataStore, AdminStore {
  constructor(private readonly db: SupabaseClient) {}

  private throwIf(error: { message: string } | null, action: string): void {
    if (error) throw new Error(`Supabase ${action} failed: ${error.message}`);
  }

  async getInstallationByGuild(
    guildId: string,
  ): Promise<GuildInstallation | null> {
    const { data, error } = await this.db
      .from("guild_installations")
      .select("org_id, guild_id")
      .eq("guild_id", guildId)
      .maybeSingle();
    this.throwIf(error, "getInstallationByGuild");
    if (!data) return null;
    return { orgId: data.org_id, guildId: data.guild_id };
  }

  async listProjectsByGuild(guildId: string): Promise<StoredProject[]> {
    const { data, error } = await this.db
      .from("projects")
      .select("*")
      .eq("guild_id", guildId);
    this.throwIf(error, "listProjectsByGuild");
    return (data as ProjectRow[] | null)?.map(toProject) ?? [];
  }

  async getProject(orgId: string, name: string): Promise<StoredProject | null> {
    const { data, error } = await this.db
      .from("projects")
      .select("*")
      .eq("org_id", orgId)
      .eq("name", name)
      .maybeSingle();
    this.throwIf(error, "getProject");
    return data ? toProject(data as ProjectRow) : null;
  }

  async getProviderCredential(
    orgId: string,
    providerId: string,
  ): Promise<ProviderCredential | null> {
    const { data, error } = await this.db
      .from("provider_credentials")
      .select("*")
      .eq("org_id", orgId)
      .eq("provider_id", providerId)
      .maybeSingle();
    this.throwIf(error, "getProviderCredential");
    if (!data) return null;
    return {
      orgId: data.org_id,
      providerId: data.provider_id,
      ciphertext: data.ciphertext,
      iv: data.iv,
      keyVersion: data.key_version,
      ...(data.base_url ? { baseUrl: data.base_url } : {}),
    };
  }

  async getContextAgent(
    orgId: string,
    contextId: string,
    projectName: string,
    providerId: string,
  ): Promise<ContextAgent | null> {
    const { data, error } = await this.db
      .from("context_agents")
      .select("*")
      .eq("org_id", orgId)
      .eq("context_id", contextId)
      .eq("project_name", projectName)
      .eq("provider_id", providerId)
      .maybeSingle();
    this.throwIf(error, "getContextAgent");
    if (!data) return null;
    return {
      orgId: data.org_id,
      contextId: data.context_id,
      projectName: data.project_name,
      providerId: data.provider_id,
      agentId: data.agent_id,
      guildId: data.guild_id,
      routeChannelId: data.route_channel_id,
    };
  }

  async setContextAgent(record: ContextAgent): Promise<void> {
    const { error } = await this.db.from("context_agents").upsert(
      {
        org_id: record.orgId,
        context_id: record.contextId,
        project_name: record.projectName,
        provider_id: record.providerId,
        agent_id: record.agentId,
        guild_id: record.guildId,
        route_channel_id: record.routeChannelId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,context_id,project_name,provider_id" },
    );
    this.throwIf(error, "setContextAgent");
  }

  async saveRun(run: NewRun): Promise<void> {
    const now = Date.now();
    const { error } = await this.db.from("runs").insert({
      org_id: run.orgId,
      run_id: run.runId,
      provider_id: run.providerId,
      agent_id: run.agentId,
      context_id: run.contextId,
      project_name: run.projectName,
      user_id: run.userId,
      discord_channel_id: run.discordChannelId,
      discord_message_id: null,
      status: run.status,
      result: null,
      pr_url: null,
      workflow_id: null,
      created_at: now,
      updated_at: now,
    });
    this.throwIf(error, "saveRun");
  }

  async setRunMessage(
    orgId: string,
    runId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const { error } = await this.db
      .from("runs")
      .update({
        discord_channel_id: channelId,
        discord_message_id: messageId,
        updated_at: Date.now(),
      })
      .eq("org_id", orgId)
      .eq("run_id", runId);
    this.throwIf(error, "setRunMessage");
  }

  async setRunWorkflowId(
    orgId: string,
    runId: string,
    workflowId: string,
  ): Promise<void> {
    const { error } = await this.db
      .from("runs")
      .update({ workflow_id: workflowId })
      .eq("org_id", orgId)
      .eq("run_id", runId);
    this.throwIf(error, "setRunWorkflowId");
  }

  async updateRun(
    orgId: string,
    runId: string,
    status: AgentRunStatus,
    result: string | null,
    prUrl: string | null,
  ): Promise<void> {
    const { error } = await this.db
      .from("runs")
      .update({
        status,
        result,
        pr_url: prUrl,
        updated_at: Date.now(),
      })
      .eq("org_id", orgId)
      .eq("run_id", runId);
    this.throwIf(error, "updateRun");
  }

  async getRun(orgId: string, runId: string): Promise<StoredRun | null> {
    const { data, error } = await this.db
      .from("runs")
      .select("*")
      .eq("org_id", orgId)
      .eq("run_id", runId)
      .maybeSingle();
    this.throwIf(error, "getRun");
    return data ? this.toRun(data) : null;
  }

  async listRunsForContext(
    orgId: string,
    contextId: string,
  ): Promise<StoredRun[]> {
    const { data, error } = await this.db
      .from("runs")
      .select("*")
      .eq("org_id", orgId)
      .eq("context_id", contextId)
      .order("created_at", { ascending: false })
      .limit(25);
    this.throwIf(error, "listRunsForContext");
    return (data ?? []).map((row) => this.toRun(row));
  }

  private toRun(row: Record<string, unknown>): StoredRun {
    return {
      orgId: row.org_id as string,
      runId: row.run_id as string,
      providerId: row.provider_id as string,
      agentId: row.agent_id as string,
      contextId: row.context_id as string,
      projectName: row.project_name as string,
      userId: row.user_id as string,
      discordChannelId: row.discord_channel_id as string,
      discordMessageId: (row.discord_message_id as string | null) ?? null,
      status: row.status as AgentRunStatus,
      result: (row.result as string | null) ?? null,
      prUrl: (row.pr_url as string | null) ?? null,
      workflowId: (row.workflow_id as string | null) ?? null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async tryRecordStart(
    orgId: string,
    userId: string,
    guildId: string,
    projectName: string,
    windowMs: number,
    maxPerWindow: number,
  ): Promise<boolean> {
    const { data, error } = await this.db.rpc("try_record_agent_start", {
      p_org_id: orgId,
      p_user_id: userId,
      p_guild_id: guildId,
      p_project_name: projectName,
      p_since: Date.now() - windowMs,
      p_max: maxPerWindow,
      p_now: Date.now(),
    });
    this.throwIf(error, "tryRecordStart");
    return data === true;
  }

  async markInteractionProcessed(interactionId: string): Promise<boolean> {
    const { error } = await this.db
      .from("processed_interactions")
      .insert({ interaction_id: interactionId, created_at: Date.now() });
    if (!error) return true;
    // 23505 = unique_violation -> already processed.
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(`Supabase markInteractionProcessed failed: ${error.message}`);
  }

  async acquireContextLock(
    orgId: string,
    contextId: string,
    projectName: string,
    expiresAtMs: number,
  ): Promise<boolean> {
    const { data, error } = await this.db.rpc("try_acquire_context_lock", {
      p_org_id: orgId,
      p_context_id: contextId,
      p_project_name: projectName,
      p_expires_at: expiresAtMs,
      p_now: Date.now(),
    });
    this.throwIf(error, "acquireContextLock");
    return data === true;
  }

  async releaseContextLock(
    orgId: string,
    contextId: string,
    projectName: string,
    expectedExpiresAtMs?: number,
  ): Promise<void> {
    let query = this.db
      .from("context_locks")
      .delete()
      .eq("org_id", orgId)
      .eq("context_id", contextId)
      .eq("project_name", projectName);
    if (expectedExpiresAtMs !== undefined) {
      query = query.eq("expires_at", expectedExpiresAtMs);
    }
    const { error } = await query;
    this.throwIf(error, "releaseContextLock");
  }

  // --- AdminStore -----------------------------------------------------------

  async createOrganization(name: string): Promise<Organization> {
    const { data, error } = await this.db
      .from("organizations")
      .insert({ name })
      .select("id, name")
      .single();
    this.throwIf(error, "createOrganization");
    return { id: data!.id, name: data!.name };
  }

  async addMember(
    orgId: string,
    discordUserId: string,
    role: string,
  ): Promise<void> {
    const { error } = await this.db
      .from("organization_members")
      .upsert(
        { org_id: orgId, user_id: discordUserId, role },
        { onConflict: "org_id,user_id" },
      );
    this.throwIf(error, "addMember");
  }

  async isMember(orgId: string, discordUserId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("organization_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", discordUserId)
      .maybeSingle();
    this.throwIf(error, "isMember");
    return data !== null;
  }

  async listOrgsForUser(discordUserId: string): Promise<Organization[]> {
    const { data, error } = await this.db
      .from("organization_members")
      .select("organizations ( id, name )")
      .eq("user_id", discordUserId);
    this.throwIf(error, "listOrgsForUser");
    const rows = (data ?? []) as unknown as Array<{
      organizations: { id: string; name: string } | { id: string; name: string }[] | null;
    }>;
    return rows
      .flatMap((row) =>
        Array.isArray(row.organizations)
          ? row.organizations
          : row.organizations
            ? [row.organizations]
            : [],
      )
      .map((org) => ({ id: org.id, name: org.name }));
  }

  async createInstallation(
    guildId: string,
    orgId: string,
    installedBy: string,
  ): Promise<void> {
    const { error } = await this.db
      .from("guild_installations")
      .upsert(
        { guild_id: guildId, org_id: orgId, installed_by: installedBy },
        { onConflict: "guild_id" },
      );
    this.throwIf(error, "createInstallation");
  }

  async listInstallationsForOrg(orgId: string): Promise<GuildInstallation[]> {
    const { data, error } = await this.db
      .from("guild_installations")
      .select("org_id, guild_id")
      .eq("org_id", orgId);
    this.throwIf(error, "listInstallationsForOrg");
    return (data ?? []).map((row) => ({
      orgId: row.org_id,
      guildId: row.guild_id,
    }));
  }

  async listProjects(orgId: string): Promise<StoredProject[]> {
    const { data, error } = await this.db
      .from("projects")
      .select("*")
      .eq("org_id", orgId);
    this.throwIf(error, "listProjects");
    return (data as ProjectRow[] | null)?.map(toProject) ?? [];
  }

  async upsertProject(project: StoredProject): Promise<void> {
    // If the repo/provider/branch of an existing project changes, any agents
    // already mapped to this project point at the *old* repo (cloud agents are
    // pinned to the repo they were created against). Drop those mappings so the
    // next prompt starts a fresh agent against the new repo instead of following
    // up on the stale one.
    const existing = await this.getProject(project.orgId, project.name);

    const { error } = await this.db.from("projects").upsert(
      {
        org_id: project.orgId,
        guild_id: project.guildId,
        name: project.name,
        display_name: project.displayName ?? null,
        channel_ids: project.channelIds,
        allowed_role_ids: project.allowedRoleIds,
        provider: project.provider,
        provider_options: project.providerOptions,
        repo_url: project.repoUrl,
        default_branch: project.defaultBranch ?? null,
        auto_create_pr: project.autoCreatePR,
      },
      { onConflict: "org_id,name" },
    );
    this.throwIf(error, "upsertProject");

    if (
      existing &&
      (existing.repoUrl !== project.repoUrl ||
        existing.provider !== project.provider ||
        existing.defaultBranch !== project.defaultBranch)
    ) {
      await this.clearContextAgentsForProject(project.orgId, project.name);
    }
  }

  async clearContextAgentsForProject(
    orgId: string,
    projectName: string,
  ): Promise<void> {
    const { error } = await this.db
      .from("context_agents")
      .delete()
      .eq("org_id", orgId)
      .eq("project_name", projectName);
    this.throwIf(error, "clearContextAgentsForProject");
  }

  async deleteProject(orgId: string, name: string): Promise<void> {
    const { error } = await this.db
      .from("projects")
      .delete()
      .eq("org_id", orgId)
      .eq("name", name);
    this.throwIf(error, "deleteProject");
  }

  async upsertCredential(credential: ProviderCredential): Promise<void> {
    const { error } = await this.db.from("provider_credentials").upsert(
      {
        org_id: credential.orgId,
        provider_id: credential.providerId,
        ciphertext: credential.ciphertext,
        iv: credential.iv,
        key_version: credential.keyVersion,
        base_url: credential.baseUrl ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,provider_id" },
    );
    this.throwIf(error, "upsertCredential");
  }

  async deleteCredential(orgId: string, providerId: string): Promise<void> {
    const { error } = await this.db
      .from("provider_credentials")
      .delete()
      .eq("org_id", orgId)
      .eq("provider_id", providerId);
    this.throwIf(error, "deleteCredential");
  }

  async listConfiguredProviderIds(orgId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from("provider_credentials")
      .select("provider_id")
      .eq("org_id", orgId);
    this.throwIf(error, "listConfiguredProviderIds");
    return (data ?? []).map((row) => row.provider_id as string);
  }
}
