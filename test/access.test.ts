import { describe, expect, it } from "vitest";
import {
  projectsVisibleToCaller,
  resolveProjectAccess,
} from "../src/security/access.js";
import type { StoredProject } from "../src/db/types.js";

function project(overrides: Partial<StoredProject>): StoredProject {
  return {
    orgId: "org-1",
    guildId: "111111111111111111",
    name: "website",
    channelIds: ["222222222222222222"],
    allowedRoleIds: ["333333333333333333"],
    provider: "cursor",
    providerOptions: {},
    repoUrl: "https://github.com/example/website",
    autoCreatePR: true,
    ...overrides,
  };
}

describe("resolveProjectAccess", () => {
  it("resolves a project by channel and allowed role", () => {
    const result = resolveProjectAccess([project({})], {
      guildId: "111111111111111111",
      routeChannelId: "222222222222222222",
      roleIds: new Set(["333333333333333333"]),
    });
    expect(result.allowed).toBe(true);
  });

  it("denies callers without an allowed role", () => {
    const result = resolveProjectAccess([project({})], {
      guildId: "111111111111111111",
      routeChannelId: "222222222222222222",
      roleIds: new Set(["999999999999999999"]),
    });
    expect(result.allowed).toBe(false);
  });

  it("requires an explicit project when multiple guild-wide projects exist", () => {
    const result = resolveProjectAccess(
      [
        project({ name: "a", channelIds: [] }),
        project({ name: "b", channelIds: [] }),
      ],
      {
        guildId: "111111111111111111",
        routeChannelId: "555555555555555555",
        roleIds: new Set(["333333333333333333"]),
      },
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toMatch(/Choose a project/);
  });

  it("honors an explicitly requested project", () => {
    const result = resolveProjectAccess(
      [project({ name: "a", channelIds: [] }), project({ name: "b", channelIds: [] })],
      {
        guildId: "111111111111111111",
        routeChannelId: "555555555555555555",
        roleIds: new Set(["333333333333333333"]),
        requestedProject: "b",
      },
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.project.name).toBe("b");
  });

  it("rejects when not in a guild", () => {
    const result = resolveProjectAccess([project({})], {
      guildId: null,
      routeChannelId: "x",
      roleIds: new Set(),
    });
    expect(result.allowed).toBe(false);
  });
});

describe("resolveProjectAccess provider override", () => {
  const openrouter = project({
    name: "chat",
    provider: "openrouter",
    channelIds: [],
    repoUrl: "",
    providerOptions: { model: "openrouter/free" },
  });
  const cursor = project({
    name: "code",
    provider: "cursor",
    channelIds: [],
    allowedRoleIds: ["444444444444444444"],
  });

  it("picks the caller's accessible project for the requested provider", () => {
    const result = resolveProjectAccess([openrouter, cursor], {
      guildId: "111111111111111111",
      routeChannelId: "555555555555555555",
      roleIds: new Set(["333333333333333333", "444444444444444444"]),
      requestedProvider: "cursor",
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.project.name).toBe("code");
  });

  it("prefers a channel-mapped project over a guild-wide one for the provider", () => {
    const mapped = project({
      name: "code-here",
      provider: "cursor",
      channelIds: ["555555555555555555"],
    });
    const wide = project({ name: "code-wide", provider: "cursor", channelIds: [] });
    const result = resolveProjectAccess([wide, mapped], {
      guildId: "111111111111111111",
      routeChannelId: "555555555555555555",
      roleIds: new Set(["333333333333333333"]),
      requestedProvider: "cursor",
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.project.name).toBe("code-here");
  });

  it("asks for a project when multiple guild-wide projects share the provider", () => {
    const result = resolveProjectAccess(
      [
        project({ name: "a", provider: "cursor", channelIds: [] }),
        project({ name: "b", provider: "cursor", channelIds: [] }),
      ],
      {
        guildId: "111111111111111111",
        routeChannelId: "555555555555555555",
        roleIds: new Set(["333333333333333333"]),
        requestedProvider: "cursor",
        requestedProviderLabel: "Cursor",
      },
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toMatch(/more than one Cursor/);
  });

  it("denies when no project uses the requested provider", () => {
    const result = resolveProjectAccess([openrouter], {
      guildId: "111111111111111111",
      routeChannelId: "555555555555555555",
      roleIds: new Set(["333333333333333333"]),
      requestedProvider: "cursor",
      requestedProviderLabel: "Cursor",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toMatch(/No Cursor agent/);
  });

  it("denies when the caller lacks a role for the requested provider", () => {
    const result = resolveProjectAccess([cursor], {
      guildId: "111111111111111111",
      routeChannelId: "555555555555555555",
      roleIds: new Set(["333333333333333333"]),
      requestedProvider: "cursor",
      requestedProviderLabel: "Cursor",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toMatch(/allowed role/);
  });

  it("rejects an explicit project that doesn't match the override provider", () => {
    const result = resolveProjectAccess([openrouter, cursor], {
      guildId: "111111111111111111",
      routeChannelId: "555555555555555555",
      roleIds: new Set(["333333333333333333", "444444444444444444"]),
      requestedProject: "chat",
      requestedProvider: "cursor",
      requestedProviderLabel: "Cursor",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toMatch(/is not a Cursor agent/);
  });
});

describe("projectsVisibleToCaller", () => {
  it("filters by role", () => {
    const visible = projectsVisibleToCaller(
      [project({ name: "a" }), project({ name: "b", allowedRoleIds: ["444"] })],
      new Set(["333333333333333333"]),
    );
    expect(visible.map((p) => p.name)).toEqual(["a"]);
  });
});
