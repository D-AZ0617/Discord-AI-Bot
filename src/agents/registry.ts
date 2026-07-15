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
export interface ProviderDefinition {
  readonly id: string;
  readonly displayName: string;
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
    if (!definition.capabilities.durableAgents) {
      errors.push(
        `${project.name}: provider ${definition.id} does not support durable follow-up sessions`,
      );
    }
    if (!definition.capabilities.repositoryAccess) {
      errors.push(
        `${project.name}: provider ${definition.id} does not support repository access`,
      );
    }
    if (project.autoCreatePR && !definition.capabilities.pullRequests) {
      errors.push(
        `${project.name}: provider ${definition.id} cannot create pull requests`,
      );
    }
    return errors;
  }

  ids(): string[] {
    return [...this.definitions.keys()].sort();
  }
}
