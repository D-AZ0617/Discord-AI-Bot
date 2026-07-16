import { describe, expect, it } from "vitest";
import {
  projectsVisibleToCaller,
  resolveProjectAccess,
} from "../src/security/access.js";
import type { StoredProject } from "../src/db/types.js";

function project(overrides: Partial<StoredProject> = {}): StoredProject {
  const channelIds =
    overrides.channelIds !== undefined
      ? overrides.channelIds
      : ["222222222222222222"];
  const channelScope =
    overrides.channelScope ??
    (channelIds.length === 0 ? "all" : "selected");
  return {
    orgId: "org-1",
    guildId: "111111111111111111",
    name: "website",
    allowedRoleIds: ["333333333333333333"],
    provider: "cursor",
    providerOptions: {},
    repoUrl: "https://github.com/example/website",
    autoCreatePR: true,
    ...overrides,
    channelScope,
    channelIds,
  };
}

describe("resolveProjectAccess", () => {
  it("resolves a channel-mapped agent by role", () => {
    const result = resolveProjectAccess([project()], {
      guildId: "111111111111111111",
      routeChannelId: "222222222222222222",
      roleIds: new Set(["333333333333333333"]),
    });
    expect(result.allowed).toBe(true);
  });

  it("denies callers without an allowed role", () => {
    const result = resolveProjectAccess([project()], {
      guildId: "111111111111111111",
      routeChannelId: "222222222222222222",
      roleIds: new Set(["999999999999999999"]),
    });
    expect(result.allowed).toBe(false);
  });

  it("uses the All-channels agent when no channel mapping exists", () => {
    const result = resolveProjectAccess(
      [project({ name: "everywhere", channelScope: "all", channelIds: [] })],
      {
        guildId: "111111111111111111",
        routeChannelId: "555555555555555555",
        roleIds: new Set(["333333333333333333"]),
      },
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.project.name).toBe("everywhere");
  });

  it("prefers a channel-mapped agent over All channels", () => {
    const result = resolveProjectAccess(
      [
        project({ name: "wide", channelScope: "all", channelIds: [] }),
        project({
          name: "here",
          channelScope: "selected",
          channelIds: ["555555555555555555"],
        }),
      ],
      {
        guildId: "111111111111111111",
        routeChannelId: "555555555555555555",
        roleIds: new Set(["333333333333333333"]),
      },
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.project.name).toBe("here");
  });

  it("rejects when the channel has no agent", () => {
    const result = resolveProjectAccess(
      [
        project({
          name: "elsewhere",
          channelScope: "selected",
          channelIds: ["999999999999999999"],
        }),
      ],
      {
        guildId: "111111111111111111",
        routeChannelId: "555555555555555555",
        roleIds: new Set(["333333333333333333"]),
      },
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toMatch(/no agent/i);
  });

  it("rejects when not in a guild", () => {
    const result = resolveProjectAccess([project()], {
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
