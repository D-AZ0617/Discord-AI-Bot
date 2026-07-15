import { describe, expect, it } from "vitest";
import {
  validateProjectInput,
  validateProjectsConfig,
} from "../src/config/schema.js";

const baseProject = {
  name: "website",
  guildId: "111111111111111111",
  channelIds: ["222222222222222222"],
  allowedRoleIds: ["333333333333333333"],
  repoUrl: "https://github.com/example/website",
};

describe("validateProjectsConfig", () => {
  it("accepts a valid project config and applies defaults", () => {
    const config = validateProjectsConfig({ version: 1, projects: [baseProject] });
    expect(config.projects[0]?.autoCreatePR).toBe(true);
    expect(config.projects[0]?.name).toBe("website");
    expect(config.projects[0]?.provider).toBe("cursor");
    expect(config.projects[0]?.providerOptions).toEqual({});
  });

  it("supports a guild-wide project with omitted channelIds", () => {
    const { channelIds: _unused, ...guildWide } = baseProject;
    const config = validateProjectsConfig({ version: 1, projects: [guildWide] });
    expect(config.projects[0]?.channelIds).toEqual([]);
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
    ).toThrow(/assigned to more than one project/);
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
  it("accepts a single valid project", () => {
    const result = validateProjectInput(baseProject);
    expect(result.ok).toBe(true);
    expect(result.project?.name).toBe("website");
  });

  it("reports validation errors for a bad project", () => {
    const result = validateProjectInput({
      ...baseProject,
      name: "Not A Slug",
      allowedRoleIds: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
