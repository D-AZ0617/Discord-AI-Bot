import type { ProjectConfig } from "../config/schema.js";
import type { AgentProvider, AgentProviderCapabilities } from "./types.js";

/** Decrypted BYOK material passed to a provider factory at request time. */
export interface DecryptedCredential {
  apiKey: string;
  baseUrl?: string;
}

/**
 * A provider definition describes a provider's identity and capabilities
 * (known at startup) and knows how to construct a live, tenant-scoped
 * {@link AgentProvider} from a decrypted credential (built per request).
 */
/** How a provider is used: `repo` runs cloud agents on a codebase; `chat`
 * answers prompts with an LLM and needs no repository. */
export type ProviderKind = "repo" | "chat";

export interface ProviderMetadata {
  id: string;
  displayName: string;
  kind: ProviderKind;
  /** Suggested model ids for chat providers (admins may type their own). */
  suggestedModels?: string[];
  /** Where the admin gets their API key. */
  apiKeyHint?: string;
}

export interface ProviderDefinition extends ProviderMetadata {
  readonly capabilities: AgentProviderCapabilities;
  create(credential: DecryptedCredential): AgentProvider;
}

/**
 * Registry of provider *definitions*. Unlike the old startup-singleton design,
 * live provider instances are created on demand from decrypted per-tenant
 * credentials, so one hosted app can serve many organizations that each bring
 * their own keys.
 */
export class AgentProviderRegistry {
  private readonly definitions = new Map<string, ProviderDefinition>();

  constructor(definitions: ProviderDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) {
        throw new Error(`Duplicate agent provider: ${definition.id}`);
      }
      this.definitions.set(definition.id, definition);
    }
  }

  has(providerId: string): boolean {
    return this.definitions.has(providerId);
  }

  get(providerId: string): ProviderDefinition {
    const definition = this.definitions.get(providerId);
    if (!definition) {
      throw new Error(
        `Agent provider "${providerId}" is not available. Available providers: ${
          this.ids().join(", ") || "none"
        }`,
      );
    }
    return definition;
  }

  forProject(project: ProjectConfig): ProviderDefinition {
    return this.get(project.provider);
  }

  /** Build a live, tenant-scoped provider from a decrypted credential. */
  createProvider(
    providerId: string,
    credential: DecryptedCredential,
  ): AgentProvider {
    return this.get(providerId).create(credential);
  }

  /** Validate a project against the provider's declared capabilities. */
  validateProject(project: ProjectConfig): string[] {
    const errors: string[] = [];
    const definition = this.definitions.get(project.provider);
    if (!definition) {
      errors.push(
        `Project "${project.name}" references unavailable provider "${project.provider}"`,
      );
      return errors;
    }

    if (definition.kind === "repo") {
      if (!project.repoUrl) {
        errors.push(`${project.name}: this provider requires a GitHub repo URL`);
      }
    } else {
      // Chat providers don't use a repository or open PRs.
      if (project.repoUrl) {
        errors.push(
          `${project.name}: ${definition.displayName} is a chat model and does not use a repository — leave the repo URL blank`,
        );
      }
      const model = project.providerOptions?.model;
      if (typeof model !== "string" || !model.trim()) {
        errors.push(`${project.name}: choose a model for ${definition.displayName}`);
      }
    }

    if (project.autoCreatePR && !definition.capabilities.pullRequests) {
      errors.push(
        `${project.name}: provider ${definition.id} cannot create pull requests`,
      );
    }
    return errors;
  }

  /** Public-safe provider metadata for the dashboard (no secrets). */
  list(): ProviderMetadata[] {
    return [...this.definitions.values()]
      .map((d) => ({
        id: d.id,
        displayName: d.displayName,
        kind: d.kind,
        ...(d.suggestedModels ? { suggestedModels: d.suggestedModels } : {}),
        ...(d.apiKeyHint ? { apiKeyHint: d.apiKeyHint } : {}),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  ids(): string[] {
    return [...this.definitions.keys()].sort();
  }
}
