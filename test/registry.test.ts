import { describe, expect, it } from "vitest";
import {
  AgentProviderRegistry,
  type DecryptedCredential,
  type ProviderDefinition,
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
): ProviderDefinition {
  return {
    id,
    displayName: id,
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

  it("flags projects that need capabilities the provider lacks", () => {
    const registry = new AgentProviderRegistry([
      definition("gemini", { repositoryAccess: false }),
    ]);
    const errors = registry.validateProject(project({ provider: "gemini" }));
    expect(errors.join("\n")).toMatch(/does not support repository access/);
  });

  it("flags projects referencing an unavailable provider", () => {
    const registry = new AgentProviderRegistry([definition("cursor")]);
    const errors = registry.validateProject(project({ provider: "claude" }));
    expect(errors.join("\n")).toMatch(/unavailable provider "claude"/);
  });

  it("default registry includes cursor", () => {
    const registry = defaultProviderRegistry();
    expect(registry.has("cursor")).toBe(true);
    const provider = registry.createProvider("cursor", { apiKey: "key" });
    expect(provider.agentUrl("abc")).toContain("abc");
  });
});
