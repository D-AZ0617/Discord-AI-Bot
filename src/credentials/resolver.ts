import type { AgentProviderRegistry } from "../agents/registry.js";
import type { AgentProvider } from "../agents/types.js";
import type { DataStore } from "../db/types.js";
import { decryptSecret, encryptSecret, type KeyRing } from "./encrypt.js";
import type { EncryptedSecret } from "./encrypt.js";

export class MissingCredentialError extends Error {
  constructor(public readonly providerId: string) {
    super(`No ${providerId} credential is configured for this server.`);
    this.name = "MissingCredentialError";
  }
}

/**
 * Resolves a live, tenant-scoped {@link AgentProvider} by loading the
 * organization's encrypted BYOK credential, decrypting it in memory, and
 * constructing the provider through the registry factory. Decrypted key
 * material is confined to this call and never persisted or logged.
 */
export class CredentialResolver {
  constructor(
    private readonly store: DataStore,
    private readonly registry: AgentProviderRegistry,
    private readonly keyRing: KeyRing,
  ) {}

  async providerFor(orgId: string, providerId: string): Promise<AgentProvider> {
    const credential = await this.store.getProviderCredential(orgId, providerId);
    if (!credential) throw new MissingCredentialError(providerId);
    const apiKey = await decryptSecret(this.keyRing, {
      ciphertext: credential.ciphertext,
      iv: credential.iv,
      keyVersion: credential.keyVersion,
    });
    return this.registry.createProvider(providerId, {
      apiKey,
      ...(credential.baseUrl ? { baseUrl: credential.baseUrl } : {}),
    });
  }

  /** Encrypt a plaintext API key for storage. */
  encrypt(apiKey: string): Promise<EncryptedSecret> {
    return encryptSecret(this.keyRing, apiKey);
  }
}
