import { describe, expect, it } from "vitest";
import {
  channelAssignmentErrors,
  validateProjectInput,
  validateProjectsConfig,
} from "../src/config/schema.js";

const baseProject = {
  name: "website",
  guildId: "111111111111111111",
  channelScope: "selected" as const,
  channelIds: ["222222222222222222"],
  allowedRoleIds: ["333333333333333333"],
  repoUrl: "https://github.com/example/website",
};

describe("validateProjectsConfig", () => {
  it("accepts a valid agent config and applies defaults", () => {
    const config = validateProjectsConfig({ version: 1, projects: [baseProject] });
    expect(config.projects[0]?.autoCreatePR).toBe(true);
    expect(config.projects[0]?.name).toBe("website");
    expect(config.projects[0]?.provider).toBe("cursor");
    expect(config.projects[0]?.channelScope).toBe("selected");
    expect(config.projects[0]?.providerOptions).toEqual({});
  });

  it("treats omitted channelIds as All channels", () => {
    const { channelIds: _unused, channelScope: _scope, ...guildWide } = baseProject;
    const config = validateProjectsConfig({ version: 1, projects: [guildWide] });
    expect(config.projects[0]?.channelIds).toEqual([]);
    expect(config.projects[0]?.channelScope).toBe("all");
  });

  it("rejects selected scope with no channels", () => {
    const result = validateProjectInput({
      ...baseProject,
      channelScope: "selected",
      channelIds: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/at least one channel/i);
  });

  it("rejects duplicate channel routes", () => {
    expect(() =>
      validateProjectsConfig({
        version: 1,
        projects: [
          baseProject,
          { ...baseProject, name: "api", repoUrl: "https://github.com/example/api" },
        ],
      }),
    ).toThrow(/already assigned|more than one/i);
  });

  it("rejects mixing All channels with selected-channel agents", () => {
    expect(() =>
      validateProjectsConfig({
        version: 1,
        projects: [
          { ...baseProject, name: "wide", channelScope: "all", channelIds: [] },
          baseProject,
        ],
      }),
    ).toThrow(/All channels/i);
  });

  it("rejects non-GitHub repository URLs", () => {
    expect(() =>
      validateProjectsConfig({
        version: 1,
        projects: [{ ...baseProject, repoUrl: "https://gitlab.com/example/site" }],
      }),
    ).toThrow(/github\.com/);
  });
});

describe("validateProjectInput", () => {
  it("accepts a single valid agent", () => {
    const result = validateProjectInput(baseProject);
    expect(result.ok).toBe(true);
    expect(result.project?.name).toBe("website");
  });

  it("reports validation errors for a bad agent", () => {
    const result = validateProjectInput({
      ...baseProject,
      name: "Not A Slug",
      allowedRoleIds: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("channelAssignmentErrors", () => {
  it("names the other agent when a channel is taken", () => {
    const errors = channelAssignmentErrors(
      [baseProject as never],
      {
        ...baseProject,
        name: "other",
        displayName: "Other Agent",
      } as never,
    );
    expect(errors.join("\n")).toMatch(/website|Website/i);
  });
});
