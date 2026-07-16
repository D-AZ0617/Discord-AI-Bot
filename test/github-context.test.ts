import { describe, expect, it } from "vitest";
import {
  filterTreePaths,
  formatCommitsForPrompt,
  mergePathPicks,
  parseGitHubRepoUrl,
  pickPathsFromModelReply,
  suggestPathsForQuestion,
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

describe("formatCommitsForPrompt", () => {
  it("formats commit lines", () => {
    const text = formatCommitsForPrompt([
      {
        sha: "abc1234",
        date: "2026-01-01T00:00:00Z",
        author: "Ada",
        message: "Fix bug",
      },
    ]);
    expect(text).toContain("abc1234");
    expect(text).toContain("Ada");
    expect(text).toContain("Fix bug");
  });
});

describe("suggestPathsForQuestion", () => {
  const tree = [
    "package.json",
    "README.md",
    "src/bot/handlers.ts",
    "src/codebase/github-context.ts",
    "docs/SETUP.md",
  ];

  it("prioritizes files mentioned in the prompt", () => {
    const paths = suggestPathsForQuestion(
      "How does handlers.ts route slash commands?",
      tree,
    );
    expect(paths[0]).toBe("src/bot/handlers.ts");
  });

  it("includes anchors and docs for commit questions", () => {
    const paths = suggestPathsForQuestion("summarize recent commits", tree);
    expect(paths).toContain("src/codebase/github-context.ts");
    expect(paths).toContain("README.md");
  });
});

describe("mergePathPicks", () => {
  it("dedupes while preserving order", () => {
    expect(
      mergePathPicks(
        ["src/a.ts", "src/b.ts"],
        ["src/b.ts", "src/c.ts"],
      ),
    ).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
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
