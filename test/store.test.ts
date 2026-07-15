import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../src/db/memory-store.js";
import { StartRateLimiter } from "../src/security/rate-limit.js";
import type { StoredProject } from "../src/db/types.js";

function seedTwoTenants(): InMemoryStore {
  const store = new InMemoryStore();
  store.seedOrganization({ id: "org-a", name: "A" });
  store.seedOrganization({ id: "org-b", name: "B" });
  store.seedInstallation({ orgId: "org-a", guildId: "guild-a" });
  store.seedInstallation({ orgId: "org-b", guildId: "guild-b" });
  const base: Omit<StoredProject, "orgId" | "guildId" | "name"> = {
    channelIds: [],
    allowedRoleIds: ["role-1"],
    provider: "cursor",
    providerOptions: {},
    repoUrl: "https://github.com/example/a",
    autoCreatePR: true,
  };
  store.seedProject({ ...base, orgId: "org-a", guildId: "guild-a", name: "alpha" });
  store.seedProject({ ...base, orgId: "org-b", guildId: "guild-b", name: "beta" });
  return store;
}

describe("InMemoryStore tenant isolation", () => {
  it("scopes projects to their guild/org", async () => {
    const store = seedTwoTenants();
    const aProjects = await store.listProjectsByGuild("guild-a");
    expect(aProjects.map((p) => p.name)).toEqual(["alpha"]);
    expect(await store.getProject("org-a", "beta")).toBeNull();
  });

  it("does not leak runs across tenants", async () => {
    const store = seedTwoTenants();
    await store.saveRun({
      orgId: "org-a",
      runId: "run-1",
      providerId: "cursor",
      agentId: "agent-1",
      contextId: "chan-1",
      projectName: "alpha",
      userId: "u1",
      discordChannelId: "chan-1",
      status: "RUNNING",
    });
    expect(await store.getRun("org-b", "run-1")).toBeNull();
    expect(await store.listRunsForContext("org-b", "chan-1")).toHaveLength(0);
    expect(await store.listRunsForContext("org-a", "chan-1")).toHaveLength(1);
  });
});

describe("idempotency", () => {
  it("returns true only the first time an interaction is seen", async () => {
    const store = new InMemoryStore();
    expect(await store.markInteractionProcessed("i-1")).toBe(true);
    expect(await store.markInteractionProcessed("i-1")).toBe(false);
    expect(await store.markInteractionProcessed("i-2")).toBe(true);
  });
});

describe("context lock", () => {
  it("prevents a second concurrent acquisition", async () => {
    const store = new InMemoryStore();
    const future = Date.now() + 60_000;
    expect(await store.acquireContextLock("org", "ctx", "p", future)).toBe(true);
    expect(await store.acquireContextLock("org", "ctx", "p", future)).toBe(false);
    await store.releaseContextLock("org", "ctx", "p");
    expect(await store.acquireContextLock("org", "ctx", "p", future)).toBe(true);
  });

  it("reclaims an expired lock", async () => {
    const store = new InMemoryStore();
    expect(await store.acquireContextLock("org", "ctx", "p", Date.now() - 1)).toBe(true);
    // Previous lock already expired, so it can be re-acquired.
    expect(
      await store.acquireContextLock("org", "ctx", "p", Date.now() + 60_000),
    ).toBe(true);
  });
});

describe("StartRateLimiter", () => {
  it("allows up to the limit then blocks", async () => {
    const store = new InMemoryStore();
    const limiter = new StartRateLimiter(store, 2);
    expect((await limiter.tryConsume("org", "u", "g", "p")).allowed).toBe(true);
    expect((await limiter.tryConsume("org", "u", "g", "p")).allowed).toBe(true);
    expect((await limiter.tryConsume("org", "u", "g", "p")).allowed).toBe(false);
  });

  it("tracks limits per user", async () => {
    const store = new InMemoryStore();
    const limiter = new StartRateLimiter(store, 1);
    expect((await limiter.tryConsume("org", "u1", "g", "p")).allowed).toBe(true);
    expect((await limiter.tryConsume("org", "u2", "g", "p")).allowed).toBe(true);
    expect((await limiter.tryConsume("org", "u1", "g", "p")).allowed).toBe(false);
  });
});
