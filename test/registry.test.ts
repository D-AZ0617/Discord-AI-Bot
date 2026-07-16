import { describe, expect, it } from "vitest";
import {
  AgentProviderRegistry,
  type DecryptedCredential,
  type ProviderDefinition,
  type ProviderKind,
} from "../src/agents/registry.js";
import { defaultProviderRegistry } from "../src/agents/providers/index.js";
import type { AgentProvider } from "../src/agents/types.js";
import type { ProjectConfig } from "../src/config/schema.js";

function fakeProvider(id: string): AgentProvider {
  return {
    id,
    displayName: id,
    capabilities: { durableAgents: true, repositoryAccess: true, pullRequests: true },
    createAgent: async () => {
      throw new Error("unused");
    },
    createRun: async () => {
      throw new Error("unused");
    },
    getRun: async () => {
      throw new Error("unused");
    },
    agentUrl: () => undefined,
    errorForUser: () => "failed",
  };
}

function definition(
  id: string,
  capabilities: Partial<ProviderDefinition["capabilities"]> = {},
  kind: ProviderKind = "repo",
): ProviderDefinition {
  return {
    id,
    displayName: id,
    kind,
    capabilities: {
      durableAgents: true,
      repositoryAccess: true,
      pullRequests: true,
      ...capabilities,
    },
    create: (_credential: DecryptedCredential) => fakeProvider(id),
  };
}

const project = (overrides: Partial<ProjectConfig>): ProjectConfig => ({
  name: "api",
  guildId: "111111111111111111",
  channelScope: "all",
  channelIds: [],
  allowedRoleIds: ["222222222222222222"],
  provider: "cursor",
  providerOptions: {},
  repoUrl: "https://github.com/example/api",
  autoCreatePR: false,
  ...overrides,
});

describe("AgentProviderRegistry", () => {
  it("builds a tenant-scoped provider through the factory", () => {
    const registry = new AgentProviderRegistry([definition("gemini")]);
    const provider = registry.createProvider("gemini", { apiKey: "secret" });
    expect(provider.id).toBe("gemini");
  });

  it("rejects unknown providers", () => {
    const registry = new AgentProviderRegistry([definition("cursor")]);
    expect(() => registry.get("claude")).toThrow(/not available/);
  });

  it("rejects duplicate provider ids", () => {
    expect(
      () => new AgentProviderRegistry([definition("openai"), definition("openai")]),
    ).toThrow(/Duplicate agent provider/);
  });

  it("requires a repo for repo providers", () => {
    const registry = new AgentProviderRegistry([definition("cursor")]);
    const errors = registry.validateProject(
      project({ provider: "cursor", repoUrl: "" }),
    );
    expect(errors.join("\n")).toMatch(/requires a GitHub repo URL/);
  });

  it("rejects a repo on chat providers and requires a model", () => {
    const registry = new AgentProviderRegistry([
      definition(
        "openai",
        { durableAgents: false, repositoryAccess: false, pullRequests: false },
        "chat",
      ),
    ]);
    const withRepo = registry.validateProject(
      project({ provider: "openai", repoUrl: "https://github.com/x/y" }),
    );
    expect(withRepo.join("\n")).toMatch(/does not use a repository/);
    expect(withRepo.join("\n")).toMatch(/choose a model/);

    const ok = registry.validateProject(
      project({ provider: "openai", repoUrl: "", providerOptions: { model: "gpt-4o-mini" } }),
    );
    expect(ok).toEqual([]);
  });

  it("requires a repo and model for code-chat providers", () => {
    const registry = new AgentProviderRegistry([
      definition(
        "codex",
        { durableAgents: false, repositoryAccess: true, pullRequests: false },
        "code-chat",
      ),
    ]);
    const missing = registry.validateProject(
      project({ provider: "codex", repoUrl: "", providerOptions: {} }),
    );
    expect(missing.join("\n")).toMatch(/public GitHub repo URL/);
    expect(missing.join("\n")).toMatch(/choose a model/);
  });

  it("allows openrouter chat without a repo but requires a model", () => {
    const registry = defaultProviderRegistry();
    const missingModel = registry.validateProject(
      project({ provider: "openrouter", repoUrl: "", providerOptions: {} }),
    );
    expect(missingModel.join("\n")).toMatch(/choose a model/);

    const chatOnly = registry.validateProject(
      project({
        provider: "openrouter",
        repoUrl: "",
        providerOptions: { model: "openrouter/free" },
        autoCreatePR: false,
      }),
    );
    expect(chatOnly).toEqual([]);

    const withRepo = registry.validateProject(
      project({
        provider: "openrouter",
        repoUrl: "https://github.com/example/api",
        providerOptions: { model: "openrouter/free" },
        autoCreatePR: false,
      }),
    );
    expect(withRepo.join("\n")).toMatch(/does not use a repository/);
  });

  it("requires a repo and model for openrouter-code", () => {
    const registry = defaultProviderRegistry();
    const missing = registry.validateProject(
      project({ provider: "openrouter-code", repoUrl: "", providerOptions: {} }),
    );
    expect(missing.join("\n")).toMatch(/public GitHub repo URL/);
    expect(missing.join("\n")).toMatch(/choose a model/);

    const withPr = registry.validateProject(
      project({
        provider: "openrouter-code",
        repoUrl: "https://github.com/example/api",
        providerOptions: { model: "openrouter/free" },
        autoCreatePR: true,
      }),
    );
    expect(withPr.join("\n")).toMatch(/cannot create pull requests/);

    const ok = registry.validateProject(
      project({
        provider: "openrouter-code",
        repoUrl: "https://github.com/example/api",
        providerOptions: { model: "openrouter/free" },
        autoCreatePR: false,
      }),
    );
    expect(ok).toEqual([]);
  });

  it("flags projects referencing an unavailable provider", () => {
    const registry = new AgentProviderRegistry([definition("cursor")]);
    const errors = registry.validateProject(project({ provider: "claude" }));
    expect(errors.join("\n")).toMatch(/unavailable provider "claude"/);
  });

  it("default registry includes cursor, chat, and openrouter variants", () => {
    const registry = defaultProviderRegistry();
    expect(registry.has("cursor")).toBe(true);
    expect(registry.has("openai")).toBe(true);
    expect(registry.has("anthropic")).toBe(true);
    expect(registry.has("google")).toBe(true);
    expect(registry.has("openrouter")).toBe(true);
    expect(registry.has("openrouter-code")).toBe(true);
    const provider = registry.createProvider("cursor", { apiKey: "key" });
    expect(provider.agentUrl("abc")).toContain("abc");
    const meta = registry.list();
    expect(meta.find((m) => m.id === "openai")?.kind).toBe("chat");
    expect(meta.find((m) => m.id === "openrouter")?.kind).toBe("chat");
    expect(meta.find((m) => m.id === "openrouter-code")?.kind).toBe("code-chat");
    expect(registry.get("openrouter").capabilities.repositoryAccess).toBe(false);
    expect(registry.get("openrouter-code").capabilities.repositoryAccess).toBe(true);
    expect(registry.get("openrouter-code").capabilities.pullRequests).toBe(false);
  });
});
