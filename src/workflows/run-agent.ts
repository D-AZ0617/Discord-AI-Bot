import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "../env.js";
import { runtimeConfig } from "../env.js";
import { defaultProviderRegistry } from "../agents/providers/index.js";
import { isTerminalStatus, type AgentRun } from "../agents/types.js";
import { loadKeyRing } from "../credentials/encrypt.js";
import { CredentialResolver } from "../credentials/resolver.js";
import { createServiceClient, SupabaseStore } from "../db/supabase-store.js";
import type { DataStore } from "../db/types.js";
import {
  editChannelMessage,
  editOriginalInteractionResponse,
} from "../discord/rest.js";
import { runEmbed } from "../bot/responses.js";
import type { AgentProvider } from "../agents/types.js";

/**
 * Everything the workflow needs to launch and monitor one agent run. Passed as
 * the workflow event payload, so it must be JSON-serializable (no live clients).
 */
export interface RunAgentParams {
  orgId: string;
  guildId: string;
  providerId: string;
  project: {
    name: string;
    displayName?: string;
    repoUrl: string;
    defaultBranch?: string;
    autoCreatePR: boolean;
    providerOptions: Record<string, unknown>;
  };
  contextId: string;
  routeChannelId: string;
  prompt: string;
  forceNew: boolean;
  /** Expiry this run set on the context lock; used to release only our own lock. */
  lockExpiry: number;
  existingAgentId: string | null;
  userId: string;
  username: string;
  applicationId: string;
  interactionToken: string;
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { retryable?: boolean }).retryable === true
  );
}

export class RunAgentWorkflow extends WorkflowEntrypoint<Env, RunAgentParams> {
  async run(
    event: WorkflowEvent<RunAgentParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const params = event.payload;
    const config = runtimeConfig(this.env);
    const store: DataStore = new SupabaseStore(createServiceClient(this.env));
    const registry = defaultProviderRegistry();
    const keyRing = await loadKeyRing(this.env.CREDENTIAL_ENCRYPTION_KEYS);
    const resolver = new CredentialResolver(store, registry, keyRing);
    const providerDisplayName = registry.get(params.providerId).displayName;

    const resolveProvider = (): Promise<AgentProvider> =>
      resolver.providerFor(params.orgId, params.providerId);

    // 1. Launch (new agent or follow-up run) with bounded retries.
    let launch: { run: AgentRun; agentUrl: string | undefined } | null = null;
    try {
      launch = await step.do(
        "launch",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () => {
          const provider = await resolveProvider();
          try {
            if (params.existingAgentId && !params.forceNew) {
              const run = await provider.createRun(
                params.existingAgentId,
                params.prompt,
                params.project.providerOptions,
              );
              return { run, agentUrl: provider.agentUrl(params.existingAgentId) };
            }
            const created = await provider.createAgent({
              prompt: params.prompt,
              ...(params.project.repoUrl
                ? { repoUrl: params.project.repoUrl }
                : {}),
              ...(params.project.defaultBranch
                ? { defaultBranch: params.project.defaultBranch }
                : {}),
              name: `${params.project.displayName ?? params.project.name} · ${params.username}`,
              autoCreatePR: params.project.autoCreatePR,
              providerOptions: params.project.providerOptions,
            });
            return {
              run: created.run,
              agentUrl: created.agent.url ?? provider.agentUrl(created.agent.id),
            };
          } catch (error) {
            const message = provider.errorForUser(error);
            if (isRetryable(error)) throw new Error(message);
            throw new NonRetryableError(message);
          }
        },
      );
    } catch (error) {
      await this.postError(params, errorMessage(error));
      await store.releaseContextLock(
        params.orgId,
        params.contextId,
        params.project.name,
        params.lockExpiry,
      );
      return;
    }
    if (!launch) return;

    const { run, agentUrl } = launch;

    // 2. Persist mapping + run and post the first status message.
    await step.do("persist-and-announce", async () => {
      await store.setContextAgent({
        orgId: params.orgId,
        contextId: params.contextId,
        projectName: params.project.name,
        providerId: params.providerId,
        agentId: run.agentId,
        guildId: params.guildId,
        routeChannelId: params.routeChannelId,
      });
      await store.saveRun({
        orgId: params.orgId,
        runId: run.id,
        providerId: params.providerId,
        agentId: run.agentId,
        contextId: params.contextId,
        projectName: params.project.name,
        userId: params.userId,
        discordChannelId: params.routeChannelId,
        status: run.status,
      });
      const message = await editOriginalInteractionResponse(
        params.applicationId,
        params.interactionToken,
        {
          embeds: [
            runEmbed(
              run,
              params.project,
              providerDisplayName,
              agentUrl,
              params.prompt,
              params.username,
            ),
          ],
        },
      );
      await store.setRunMessage(
        params.orgId,
        run.id,
        message.channel_id,
        message.id,
      );
    });

    // 3. Poll until terminal or timeout, editing the message on change.
    const maxPolls = Math.min(
      2000,
      Math.ceil((config.agentTimeoutMinutes * 60_000) / config.pollIntervalMs),
    );
    let lastStatus = run.status;
    if (isTerminalStatus(run.status)) {
      await this.finish(store, params, run.id);
      return;
    }

    for (let i = 0; i < maxPolls; i++) {
      await step.sleep(`wait-${i}`, config.pollIntervalMs);
      const polled = await step.do(
        `poll-${i}`,
        { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } },
        async () => {
          const provider = await resolveProvider();
          const current = await provider.getRun(run.agentId, run.id);
          const prUrl =
            current.git?.branches.find((branch) => branch.prUrl)?.prUrl ?? null;
          await store.updateRun(
            params.orgId,
            current.id,
            current.status,
            current.result ?? null,
            prUrl,
          );
          return {
            current,
            changed: current.status !== lastStatus,
            agentUrl: provider.agentUrl(current.agentId),
          };
        },
      );

      if (polled.changed || isTerminalStatus(polled.current.status)) {
        await step.do(`edit-${i}`, async () => {
          await this.editMessage(
            store,
            params,
            polled.current,
            providerDisplayName,
            polled.agentUrl,
          );
        });
        lastStatus = polled.current.status;
      }
      if (isTerminalStatus(polled.current.status)) break;
    }

    await this.finish(store, params, run.id);
  }

  private async finish(
    store: DataStore,
    params: RunAgentParams,
    _runId: string,
  ): Promise<void> {
    await store.releaseContextLock(
      params.orgId,
      params.contextId,
      params.project.name,
      params.lockExpiry,
    );
  }

  private async editMessage(
    store: DataStore,
    params: RunAgentParams,
    run: AgentRun,
    providerDisplayName: string,
    agentUrl: string | undefined,
  ): Promise<void> {
    const stored = await store.getRun(params.orgId, run.id);
    if (!stored?.discordMessageId) return;
    const embed = runEmbed(
      run,
      params.project,
      providerDisplayName,
      agentUrl,
      params.prompt,
      params.username,
    );
    // Use the bot token so edits keep working past the 15-minute interaction
    // token expiry.
    await editChannelMessage(
      this.env.DISCORD_BOT_TOKEN,
      stored.discordChannelId,
      stored.discordMessageId,
      { embeds: [embed] },
    );
  }

  private async postError(
    params: RunAgentParams,
    message: string,
  ): Promise<void> {
    try {
      await editOriginalInteractionResponse(
        params.applicationId,
        params.interactionToken,
        { content: message },
      );
    } catch {
      // Interaction token may have expired; nothing else to do.
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The agent could not be started. Please try again.";
}
