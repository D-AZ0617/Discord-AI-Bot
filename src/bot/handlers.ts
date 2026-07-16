import type { AgentProviderRegistry } from "../agents/registry.js";
import type { Env, RuntimeConfig } from "../env.js";
import type { DataStore, StoredProject, StoredRun } from "../db/types.js";
import { isTerminalStatus } from "../agents/types.js";
import {
  CANCEL_COMMANDS,
  LIST_COMMANDS,
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
  deferredEphemeral,
  deferredPublic,
  ephemeralEmbed,
  ephemeralMessage,
  getStringOption,
  routeChannelId,
  type DiscordInteraction,
} from "../discord/interactions.js";
import {
  projectsVisibleToCaller,
  resolveProjectAccess,
} from "../security/access.js";
import { isAllChannelsAgent } from "../config/schema.js";
import { StartRateLimiter } from "../security/rate-limit.js";
import { runEmbed, truncate } from "./responses.js";
import { credentialProviderId, runtimeProviderId } from "../credentials/aliases.js";
import { loadKeyRing } from "../credentials/encrypt.js";
import { CredentialResolver } from "../credentials/resolver.js";
import {
  editChannelMessage,
  editOriginalInteractionResponse,
} from "../discord/rest.js";
import { codeChatCacheKey } from "../codebase/context-cache.js";
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
    private readonly ctx?: ExecutionContext,
  ) {
    this.limiter = new StartRateLimiter(store, config.newAgentsPerUserPerHour);
  }

  async handleCommand(interaction: DiscordInteraction): Promise<Response> {
    const name = interaction.data?.name ?? "";
    if (PROMPT_COMMANDS.has(name)) return this.handlePrompt(interaction, false);
    if (NEW_AGENT_COMMANDS.has(name)) return this.handlePrompt(interaction, true);
    if (STATUS_COMMANDS.has(name)) return this.handleStatus(interaction);
    if (LIST_COMMANDS.has(name) || PROJECTS_COMMANDS.has(name)) {
      return this.handleList(interaction);
    }
    if (CANCEL_COMMANDS.has(name)) return this.handleCancel(interaction);
    return ephemeralMessage("Unknown command.");
  }

  async handleAutocomplete(_interaction: DiscordInteraction): Promise<Response> {
    return autocompleteResult([]);
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
    });
    if (!access.allowed) return ephemeralMessage(access.message);
    const project = access.project;
    const providerId = runtimeProviderId(project.provider, project.repoUrl);

    if (!this.registry.has(providerId)) {
      return ephemeralMessage(
        `Provider \`${project.provider}\` is not available in this app.`,
      );
    }
    const credential = await this.store.getProviderCredential(
      installation.orgId,
      credentialProviderId(providerId),
    );
    if (!credential) {
      return ephemeralMessage(
        `No ${this.registry.get(providerId).displayName} API key is configured for this server yet. An administrator can add one at ${this.env.PUBLIC_BASE_URL}`,
      );
    }

    const providerDef = this.registry.get(providerId);
    if (
      providerDef.kind === "code-chat" &&
      !(project.repoUrl && project.repoUrl.trim())
    ) {
      return ephemeralMessage(
        `Project **${project.displayName ?? project.name}** (\`${project.name}\`) is OpenRouter codebase Q&A but has no GitHub repo URL saved. In the dashboard, edit that project, set **GitHub repo URL** to \`https://github.com/owner/repo\`, and click **Update project**.`,
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
      providerId,
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
      lockExpiry,
      existingAgentId: existing?.agentId ?? null,
      userId,
      username: callerUsername(interaction),
      applicationId: interaction.application_id,
      interactionToken: interaction.token,
      ...(providerDef.kind === "code-chat"
        ? {
            contextCacheKey: codeChatCacheKey(
              installation.orgId,
              contextId,
              project.name,
            ),
          }
        : {}),
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

  private async handleList(
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
        "You do not have access to any configured agents in this server.",
      );
    }
    const lines = projects.map((project: StoredProject) => {
      const scope = isAllChannelsAgent(project)
        ? "all channels"
        : project.channelIds.map((id) => `<#${id}>`).join(", ");
      const target = project.repoUrl?.trim()
        ? project.repoUrl.trim()
        : project.providerOptions?.model
          ? `model ${String(project.providerOptions.model)}`
          : "no repo/model";
      return `• **${project.displayName ?? project.name}** — ${project.provider} — ${target} — ${scope}`;
    });
    const tip =
      "\n\n_Tip: `/agent` always uses this channel's agent. Want a different AI? Use a different channel, or ask an admin to change the channel's agent in the dashboard._";
    return ephemeralEmbed({
      title: "Agents you can access",
      description: truncate(lines.join("\n") + tip, 4000),
      color: BRAND_COLOR,
    });
  }

  /**
   * Cancel the agent currently running in this channel. Cancellation touches the
   * provider (a network call) and a Discord edit, which can exceed Discord's 3s
   * interaction budget, so we defer immediately and finish the work in the
   * background, then edit the ephemeral reply with the outcome.
   */
  private async handleCancel(
    interaction: DiscordInteraction,
  ): Promise<Response> {
    const guildId = interaction.guild_id ?? null;
    if (!guildId) {
      return ephemeralMessage("This bot only works inside a Discord server.");
    }
    const fresh = await this.store.markInteractionProcessed(interaction.id);
    if (!fresh) return deferredEphemeral();

    if (!this.ctx) {
      // No background context (e.g. tests): run inline.
      return ephemeralMessage(await this.performCancel(interaction, guildId));
    }

    this.ctx.waitUntil(
      (async () => {
        let summary: string;
        try {
          summary = await this.performCancel(interaction, guildId);
        } catch (error) {
          console.error("Cancel failed", safeError(error));
          summary =
            "Something went wrong cancelling the agent. The channel lock was left in place; try `/agent-cancel` again shortly.";
        }
        await editOriginalInteractionResponse(
          interaction.application_id,
          interaction.token,
          { content: summary },
        ).catch(() => {});
      })(),
    );
    return deferredEphemeral();
  }

  private async performCancel(
    interaction: DiscordInteraction,
    guildId: string,
  ): Promise<string> {
    const installation = await this.store.getInstallationByGuild(guildId);
    if (!installation) return this.setupHint();

    const guildProjects = await this.store.listProjectsByGuild(guildId);
    const access = resolveProjectAccess(guildProjects, {
      guildId,
      routeChannelId: routeChannelId(interaction),
      roleIds: new Set(callerRoleIds(interaction)),
    });
    if (!access.allowed) return access.message;
    const project = access.project;
    const contextId = interaction.channel_id ?? routeChannelId(interaction);

    const runs = await this.store.listRunsForContext(
      installation.orgId,
      contextId,
    );
    const active = runs.find(
      (run: StoredRun) =>
        run.projectName === project.name &&
        run.providerId === project.provider &&
        !isTerminalStatus(run.status),
    );

    if (!active) {
      // Nothing running, but the channel may be stuck on a stale lock. Clearing
      // it (force release) lets the user start a fresh prompt immediately.
      await this.store.releaseContextLock(
        installation.orgId,
        contextId,
        project.name,
      );
      return "No agent is currently running here. Cleared any stale lock — you can start a new prompt.";
    }

    let providerNote = "";
    try {
      if (this.registry.has(runtimeProviderId(project.provider, project.repoUrl))) {
        const providerId = runtimeProviderId(project.provider, project.repoUrl);
        const credential = await this.store.getProviderCredential(
          installation.orgId,
          credentialProviderId(providerId),
        );
        if (credential) {
          const resolver = new CredentialResolver(
            this.store,
            this.registry,
            await loadKeyRing(this.env.CREDENTIAL_ENCRYPTION_KEYS),
          );
          const provider = await resolver.providerFor(
            installation.orgId,
            providerId,
          );
          if (provider.cancelRun) {
            await provider.cancelRun(active.agentId, active.runId);
          }
          if (active.discordMessageId) {
            const embed = runEmbed(
              {
                id: active.runId,
                agentId: active.agentId,
                status: "CANCELLED",
                createdAt: new Date(active.createdAt).toISOString(),
                updatedAt: new Date().toISOString(),
              },
              project,
              this.registry.get(providerId).displayName,
              provider.agentUrl(active.agentId),
            );
            await editChannelMessage(
              this.env.DISCORD_BOT_TOKEN,
              active.discordChannelId,
              active.discordMessageId,
              { embeds: [embed] },
            ).catch(() => {});
          }
        }
      }
    } catch (error) {
      console.error("Provider cancel failed", safeError(error));
      providerNote =
        " The provider could not confirm cancellation, but the channel is unlocked.";
    }

    await this.store.updateRun(
      installation.orgId,
      active.runId,
      "CANCELLED",
      active.result ?? null,
      active.prUrl ?? null,
    );
    await this.store.releaseContextLock(
      installation.orgId,
      contextId,
      project.name,
    );

    return `Cancelled the running agent for **${project.displayName ?? project.name}**.${providerNote} You can start a new prompt now.`;
  }
}

function safeError(error: unknown): object {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}
