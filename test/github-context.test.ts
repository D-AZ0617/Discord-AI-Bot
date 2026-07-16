import { describe, expect, it } from "vitest";
import {
  filterTreePaths,
  parseGitHubRepoUrl,
  pickPathsFromModelReply,
} from "../src/codebase/github-context.js";

describe("parseGitHubRepoUrl", () => {
  it("parses owner and repo", () => {
    expect(parseGitHubRepoUrl("https://github.com/acme/widget")).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });

  it("strips .git and trailing path noise", () => {
    expect(parseGitHubRepoUrl("https://github.com/acme/widget.git")).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });

  it("rejects non-github hosts", () => {
    expect(() => parseGitHubRepoUrl("https://gitlab.com/acme/widget")).toThrow(
      /github\.com/,
    );
  });
});

describe("filterTreePaths", () => {
  it("keeps source files and drops vendor dirs", () => {
    const paths = filterTreePaths([
      "src/index.ts",
      "node_modules/foo/index.js",
      "README.md",
      "dist/bundle.js",
      "docs/guide.md",
      "binary.png",
      "package.json",
    ]);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("README.md");
    expect(paths).toContain("docs/guide.md");
    expect(paths).toContain("package.json");
    expect(paths).not.toContain("node_modules/foo/index.js");
    expect(paths).not.toContain("dist/bundle.js");
    expect(paths).not.toContain("binary.png");
  });
});

describe("pickPathsFromModelReply", () => {
  const allowed = new Set([
    "src/bot/handlers.ts",
    "src/agents/registry.ts",
    "README.md",
    "package.json",
  ]);

  it("parses a JSON array of paths", () => {
    const picked = pickPathsFromModelReply(
      'Here you go:\n["src/bot/handlers.ts", "README.md", "missing.ts"]\n',
      allowed,
    );
    expect(picked).toEqual(["src/bot/handlers.ts", "README.md"]);
  });

  it("falls back to line scanning", () => {
    const picked = pickPathsFromModelReply(
      "- src/agents/registry.ts\n- package.json\n- not-in-tree.ts",
      allowed,
    );
    expect(picked).toEqual(["src/agents/registry.ts", "package.json"]);
  });
});
