import type { AgentProviderRegistry } from "../agents/registry.js";
import type { Env, RuntimeConfig } from "../env.js";
import type { DataStore, StoredProject } from "../db/types.js";
import {
  NEW_AGENT_COMMANDS,
  PROJECTS_COMMANDS,
  PROMPT_COMMANDS,
  STATUS_COMMANDS,
} from "../discord/commands.js";
import {
  autocompleteResult,
  callerRoleIds,
  callerUserId,
  callerUsername,
  deferredPublic,
  ephemeralEmbed,
  ephemeralMessage,
  getFocusedOption,
  getStringOption,
  routeChannelId,
  type DiscordInteraction,
} from "../discord/interactions.js";
import {
  projectsVisibleToCaller,
  resolveProjectAccess,
} from "../security/access.js";
import { StartRateLimiter } from "../security/rate-limit.js";
import { truncate } from "./responses.js";
import type { RunAgentParams } from "../workflows/run-agent.js";

const BRAND_COLOR = 0x5865f2;

/**
 * Handles a verified Discord command interaction and returns the immediate
 * HTTP response Discord expects within three seconds. Long-running work is
 * delegated to the durable workflow.
 */
export class CommandRouter {
  private readonly limiter: StartRateLimiter;

  constructor(
    private readonly env: Env,
    private readonly store: DataStore,
    private readonly registry: AgentProviderRegistry,
    private readonly config: RuntimeConfig,
  ) {
    this.limiter = new StartRateLimiter(store, config.newAgentsPerUserPerHour);
  }

  async handleCommand(interaction: DiscordInteraction): Promise<Response> {
    const name = interaction.data?.name ?? "";
    if (PROMPT_COMMANDS.has(name)) return this.handlePrompt(interaction, false);
    if (NEW_AGENT_COMMANDS.has(name)) return this.handlePrompt(interaction, true);
    if (STATUS_COMMANDS.has(name)) return this.handleStatus(interaction);
    if (PROJECTS_COMMANDS.has(name)) return this.handleProjects(interaction);
    return ephemeralMessage("Unknown command.");
  }

  async handleAutocomplete(interaction: DiscordInteraction): Promise<Response> {
    const guildId = interaction.guild_id ?? null;
    if (!guildId) return autocompleteResult([]);
    const installation = await this.store.getInstallationByGuild(guildId);
    if (!installation) return autocompleteResult([]);
    const roleIds = new Set(callerRoleIds(interaction));
    const query = String(getFocusedOption(interaction)?.value ?? "").toLowerCase();
    const projects = projectsVisibleToCaller(
      await this.store.listProjectsByGuild(guildId),
      roleIds,
    )
      .filter(
        (project) =>
          project.name.includes(query) ||
          project.displayName?.toLowerCase().includes(query),
      )
      .slice(0, 25)
      .map((project) => ({
        name: project.displayName
          ? `${project.displayName} (${project.name})`
          : project.name,
        value: project.name,
      }));
    return autocompleteResult(projects);
  }

  private setupHint(): string {
    return `This server is not configured yet. An administrator can set it up at ${this.env.PUBLIC_BASE_URL}`;
  }

  private async handlePrompt(
    interaction: DiscordInteraction,
    forceNew: boolean,
  ): Promise<Response> {
    const guildId = interaction.guild_id ?? null;
    if (!guildId) {
      return ephemeralMessage("This bot only works inside a Discord server.");
    }
    const userId = callerUserId(interaction);
    if (!userId) return ephemeralMessage("Could not identify the caller.");

    // Idempotency: never process the same interaction twice.
    const fresh = await this.store.markInteractionProcessed(interaction.id);
    if (!fresh) return deferredPublic();

    const installation = await this.store.getInstallationByGuild(guildId);
    if (!installation) return ephemeralMessage(this.setupHint());

    const prompt = (getStringOption(interaction, "prompt") ?? "").trim();
    if (!prompt) return ephemeralMessage("Prompt cannot be empty.");

    const guildProjects = await this.store.listProjectsByGuild(guildId);
    const access = resolveProjectAccess(guildProjects, {
      guildId,
      routeChannelId: routeChannelId(interaction),
      roleIds: new Set(callerRoleIds(interaction)),
      requestedProject: getStringOption(interaction, "project"),
    });
    if (!access.allowed) return ephemeralMessage(access.message);
    const project = access.project;

    if (!this.registry.has(project.provider)) {
      return ephemeralMessage(
        `Provider \`${project.provider}\` is not available in this app.`,
      );
    }
    const credential = await this.store.getProviderCredential(
      installation.orgId,
      project.provider,
    );
    if (!credential) {
      return ephemeralMessage(
        `No \`${project.provider}\` API key is configured for this server yet. An administrator can add one at ${this.env.PUBLIC_BASE_URL}`,
      );
    }

    const contextId = interaction.channel_id ?? routeChannelId(interaction);
    const existing = forceNew
      ? null
      : await this.store.getContextAgent(
          installation.orgId,
          contextId,
          project.name,
          project.provider,
        );

    if (!existing) {
      const limit = await this.limiter.tryConsume(
        installation.orgId,
        userId,
        guildId,
        project.name,
      );
      if (!limit.allowed) return ephemeralMessage(limit.message);
    }

    const lockExpiry =
      Date.now() + this.config.agentTimeoutMinutes * 60_000 + 60_000;
    const acquired = await this.store.acquireContextLock(
      installation.orgId,
      contextId,
      project.name,
      lockExpiry,
    );
    if (!acquired) {
      return ephemeralMessage(
        "Another prompt is already running for this project here. Try again once it finishes.",
      );
    }

    const params: RunAgentParams = {
      orgId: installation.orgId,
      guildId,
      providerId: project.provider,
      project: {
        name: project.name,
        ...(project.displayName ? { displayName: project.displayName } : {}),
        repoUrl: project.repoUrl,
        ...(project.defaultBranch ? { defaultBranch: project.defaultBranch } : {}),
        autoCreatePR: project.autoCreatePR,
        providerOptions: project.providerOptions,
      },
      contextId,
      routeChannelId: routeChannelId(interaction),
      prompt,
      forceNew,
      existingAgentId: existing?.agentId ?? null,
      userId,
      username: callerUsername(interaction),
      applicationId: interaction.application_id,
      interactionToken: interaction.token,
    };

    try {
      await this.env.RUN_AGENT_WORKFLOW.create({
        id: interaction.id,
        params,
      });
    } catch (error) {
      await this.store.releaseContextLock(
        installation.orgId,
        contextId,
        project.name,
      );
      console.error("Failed to start workflow", safeError(error));
      return ephemeralMessage(
        "Could not start the agent right now. Please try again shortly.",
      );
    }

    return deferredPublic();
  }

  private async handleStatus(
    interaction: DiscordInteraction,
  ): Promise<Response> {
    const guildId = interaction.guild_id ?? null;
    if (!guildId) {
      return ephemeralMessage("This bot only works inside a Discord server.");
    }
    const installation = await this.store.getInstallationByGuild(guildId);
    if (!installation) return ephemeralMessage(this.setupHint());

    const contextId = interaction.channel_id ?? routeChannelId(interaction);
    const runs = await this.store.listRunsForContext(
      installation.orgId,
      contextId,
    );
    if (runs.length === 0) {
      return ephemeralMessage(
        "No agent runs are recorded for this channel or thread.",
      );
    }
    const roleIds = new Set(callerRoleIds(interaction));
    const visibleNames = new Set(
      projectsVisibleToCaller(
        await this.store.listProjectsByGuild(guildId),
        roleIds,
      ).map((project) => project.name),
    );
    const visible = runs.filter((run) => visibleNames.has(run.projectName));
    if (visible.length === 0) {
      return ephemeralMessage("No agent runs are visible to your roles here.");
    }
    const lines = visible.map(
      (run) =>
        `• **${run.projectName}** · ${run.providerId} — ${run.status} — \`${run.agentId}\`${run.prUrl ? ` — [PR](${run.prUrl})` : ""}`,
    );
    return ephemeralEmbed({
      title: "Agent runs in this channel/thread",
      description: truncate(lines.join("\n"), 4000),
      color: BRAND_COLOR,
    });
  }

  private async handleProjects(
    interaction: DiscordInteraction,
  ): Promise<Response> {
    const guildId = interaction.guild_id ?? null;
    if (!guildId) {
      return ephemeralMessage("This bot only works inside a Discord server.");
    }
    const installation = await this.store.getInstallationByGuild(guildId);
    if (!installation) return ephemeralMessage(this.setupHint());

    const roleIds = new Set(callerRoleIds(interaction));
    const projects = projectsVisibleToCaller(
      await this.store.listProjectsByGuild(guildId),
      roleIds,
    );
    if (projects.length === 0) {
      return ephemeralMessage(
        "You do not have access to any configured projects in this server.",
      );
    }
    const lines = projects.map((project: StoredProject) => {
      const scope =
        project.channelIds.length === 0
          ? "guild-wide"
          : project.channelIds.map((id) => `<#${id}>`).join(", ");
      return `• **${project.displayName ?? project.name}** (\`${project.name}\`) — ${project.provider} — ${scope}`;
    });
    return ephemeralEmbed({
      title: "Projects you can access",
      description: truncate(lines.join("\n"), 4000),
      color: BRAND_COLOR,
    });
  }
}

function safeError(error: unknown): object {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}
