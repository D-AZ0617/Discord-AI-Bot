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

describe("projectsVisibleToCaller", () => {
  it("filters by role", () => {
    const visible = projectsVisibleToCaller(
      [project({ name: "a" }), project({ name: "b", allowedRoleIds: ["444"] })],
      new Set(["333333333333333333"]),
    );
    expect(visible.map((p) => p.name)).toEqual(["a"]);
  });
});
