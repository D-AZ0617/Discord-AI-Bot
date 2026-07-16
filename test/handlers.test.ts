import { beforeEach, describe, expect, it } from "vitest";
import { CommandRouter } from "../src/bot/handlers.js";
import { defaultProviderRegistry } from "../src/agents/providers/index.js";
import { InMemoryStore } from "../src/db/memory-store.js";
import type { Env, RuntimeConfig } from "../src/env.js";
import type { DiscordInteraction } from "../src/discord/interactions.js";
import type { StoredProject } from "../src/db/types.js";

interface CreatedWorkflow {
  id: string;
  params: unknown;
}

function makeEnv(created: CreatedWorkflow[], failCreate = false): Env {
  return {
    PUBLIC_BASE_URL: "https://setup.example",
    RUN_AGENT_WORKFLOW: {
      create: async (options: { id: string; params: unknown }) => {
        if (failCreate) throw new Error("workflow down");
        created.push(options);
        return {};
      },
    },
  } as unknown as Env;
}

const config: RuntimeConfig = {
  newAgentsPerUserPerHour: 5,
  pollIntervalMs: 5000,
  agentTimeoutMinutes: 120,
};

function seededStore(): InMemoryStore {
  const store = new InMemoryStore();
  store.seedOrganization({ id: "org-a", name: "A" });
  store.seedInstallation({ orgId: "org-a", guildId: "guild-a" });
  const project: StoredProject = {
    orgId: "org-a",
    guildId: "guild-a",
    name: "website",
    channelScope: "selected",
    channelIds: ["chan-1"],
    allowedRoleIds: ["role-1"],
    provider: "cursor",
    providerOptions: {},
    repoUrl: "https://github.com/example/website",
    autoCreatePR: true,
  };
  store.seedProject(project);
  store.seedCredential({
    orgId: "org-a",
    providerId: "cursor",
    ciphertext: "x",
    iv: "y",
    keyVersion: 1,
  });
  return store;
}

function interaction(overrides: Partial<DiscordInteraction> = {}): DiscordInteraction {
  return {
    id: "int-1",
    application_id: "app-1",
    type: 2,
    token: "tok",
    guild_id: "guild-a",
    channel_id: "chan-1",
    member: { roles: ["role-1"], user: { id: "user-1", username: "alice" } },
    data: {
      id: "cmd",
      name: "agent",
      options: [{ name: "prompt", type: 3, value: "do the thing" }],
    },
    ...overrides,
  };
}

async function bodyOf(response: Response): Promise<{ type: number; data?: { flags?: number; content?: string } }> {
  return response.json() as Promise<{ type: number; data?: { flags?: number; content?: string } }>;
}

describe("CommandRouter.handleCommand", () => {
  let created: CreatedWorkflow[];
  let store: InMemoryStore;
  let router: CommandRouter;

  beforeEach(() => {
    created = [];
    store = seededStore();
    router = new CommandRouter(makeEnv(created), store, defaultProviderRegistry(), config);
  });

  it("starts a new agent and defers", async () => {
    const response = await router.handleCommand(interaction());
    const body = await bodyOf(response);
    expect(body.type).toBe(5); // deferred
    expect(created).toHaveLength(1);
    expect(created[0]?.id).toBe("int-1");
    const params = created[0]?.params as { orgId: string; forceNew: boolean; existingAgentId: string | null };
    expect(params.orgId).toBe("org-a");
    expect(params.forceNew).toBe(false);
    expect(params.existingAgentId).toBeNull();
  });

  it("is idempotent for a repeated interaction id", async () => {
    await router.handleCommand(interaction());
    const second = await router.handleCommand(interaction());
    expect((await bodyOf(second)).type).toBe(5);
    expect(created).toHaveLength(1); // not triggered twice
  });

  it("continues an existing agent as a follow-up without consuming rate limit", async () => {
    await store.setContextAgent({
      orgId: "org-a",
      contextId: "chan-1",
      projectName: "website",
      providerId: "cursor",
      agentId: "agent-existing",
      guildId: "guild-a",
      routeChannelId: "chan-1",
    });
    const response = await router.handleCommand(interaction());
    expect((await bodyOf(response)).type).toBe(5);
    const params = created[0]?.params as { existingAgentId: string | null; forceNew: boolean };
    expect(params.existingAgentId).toBe("agent-existing");
  });

  it("rejects unconfigured guilds with a setup hint", async () => {
    const response = await router.handleCommand(
      interaction({ id: "int-x", guild_id: "guild-unknown" }),
    );
    const body = await bodyOf(response);
    expect(body.type).toBe(4);
    expect(body.data?.content).toContain("setup.example");
  });

  it("rejects callers without an allowed role", async () => {
    const response = await router.handleCommand(
      interaction({ id: "int-y", member: { roles: ["role-nope"], user: { id: "u2", username: "bob" } } }),
    );
    const body = await bodyOf(response);
    expect(body.type).toBe(4);
    expect(created).toHaveLength(0);
  });

  it("reports when the provider key is missing", async () => {
    const bare = new InMemoryStore();
    bare.seedOrganization({ id: "org-a", name: "A" });
    bare.seedInstallation({ orgId: "org-a", guildId: "guild-a" });
    bare.seedProject({
      orgId: "org-a",
      guildId: "guild-a",
      name: "website",
      channelScope: "selected",
      channelIds: ["chan-1"],
      allowedRoleIds: ["role-1"],
      provider: "cursor",
      providerOptions: {},
      repoUrl: "https://github.com/example/website",
      autoCreatePR: true,
    });
    const bareRouter = new CommandRouter(makeEnv(created), bare, defaultProviderRegistry(), config);
    const body = await bodyOf(await bareRouter.handleCommand(interaction({ id: "int-z" })));
    expect(body.type).toBe(4);
    expect(body.data?.content).toContain("API key");
  });

  it("enforces the per-user new-agent rate limit across contexts", async () => {
    // A guild-wide project can be used from any channel, so each call is a new
    // agent in a distinct context (distinct lock) and the limiter is the gate.
    const wide = new InMemoryStore();
    wide.seedOrganization({ id: "org-a", name: "A" });
    wide.seedInstallation({ orgId: "org-a", guildId: "guild-a" });
    wide.seedProject({
      orgId: "org-a",
      guildId: "guild-a",
      name: "website",
      channelScope: "all",
      channelIds: [],
      allowedRoleIds: ["role-1"],
      provider: "cursor",
      providerOptions: {},
      repoUrl: "https://github.com/example/website",
      autoCreatePR: true,
    });
    wide.seedCredential({ orgId: "org-a", providerId: "cursor", ciphertext: "x", iv: "y", keyVersion: 1 });

    const limited = new CommandRouter(makeEnv(created), wide, defaultProviderRegistry(), {
      ...config,
      newAgentsPerUserPerHour: 1,
    });
    const first = await limited.handleCommand(interaction({ id: "a", channel_id: "c1" }));
    expect((await bodyOf(first)).type).toBe(5);
    const second = await limited.handleCommand(interaction({ id: "b", channel_id: "c2" }));
    const body = await bodyOf(second);
    expect(body.type).toBe(4);
    expect(body.data?.content).toMatch(/limit/);
  });

  it("blocks when a context lock is already held", async () => {
    await store.acquireContextLock("org-a", "chan-1", "website", Date.now() + 60_000);
    const body = await bodyOf(await router.handleCommand(interaction()));
    expect(body.type).toBe(4);
    expect(body.data?.content).toMatch(/already running/);
    expect(created).toHaveLength(0);
  });

  it("releases the lock and reports when the workflow fails to start", async () => {
    const failing = new CommandRouter(makeEnv(created, true), store, defaultProviderRegistry(), config);
    const body = await bodyOf(await failing.handleCommand(interaction()));
    expect(body.type).toBe(4);
    // Lock must have been released so a retry can proceed.
    expect(
      await store.acquireContextLock("org-a", "chan-1", "website", Date.now() + 1000),
    ).toBe(true);
  });

  const cancelInteraction = (overrides: Partial<DiscordInteraction> = {}) =>
    interaction({
      id: "cancel-1",
      data: { id: "cmd", name: "agent-cancel", options: [] },
      ...overrides,
    });

  it("clears a stale lock when nothing is running", async () => {
    await store.acquireContextLock("org-a", "chan-1", "website", Date.now() + 60_000);
    const body = await bodyOf(await router.handleCommand(cancelInteraction()));
    expect(body.type).toBe(4);
    expect(body.data?.content).toMatch(/stale lock/);
    // Lock released -> a new prompt can acquire it.
    expect(
      await store.acquireContextLock("org-a", "chan-1", "website", Date.now() + 1000),
    ).toBe(true);
  });

  it("cancels an active run and releases the lock", async () => {
    await store.setContextAgent({
      orgId: "org-a",
      contextId: "chan-1",
      projectName: "website",
      providerId: "cursor",
      agentId: "agent-live",
      guildId: "guild-a",
      routeChannelId: "chan-1",
    });
    await store.saveRun({
      orgId: "org-a",
      runId: "run-live",
      providerId: "cursor",
      agentId: "agent-live",
      contextId: "chan-1",
      projectName: "website",
      userId: "user-1",
      discordChannelId: "chan-1",
      status: "RUNNING",
    });
    await store.acquireContextLock("org-a", "chan-1", "website", Date.now() + 60_000);

    const body = await bodyOf(await router.handleCommand(cancelInteraction()));
    expect(body.type).toBe(4);
    expect(body.data?.content).toMatch(/Cancelled the running agent/);
    expect((await store.getRun("org-a", "run-live"))?.status).toBe("CANCELLED");
    expect(
      await store.acquireContextLock("org-a", "chan-1", "website", Date.now() + 1000),
    ).toBe(true);
  });
});
