/** Providers that reuse another provider's stored API key. */
const CREDENTIAL_ALIASES: Record<string, string> = {
  "openrouter-code": "openrouter",
};

/** Provider id used when reading or writing encrypted credentials. */
export function credentialProviderId(providerId: string): string {
  return CREDENTIAL_ALIASES[providerId] ?? providerId;
}

/** Runtime provider for legacy agents saved before openrouter-code existed. */
export function runtimeProviderId(
  providerId: string,
  repoUrl?: string | null,
): string {
  if (providerId === "openrouter" && repoUrl?.trim()) {
    return "openrouter-code";
  }
  return providerId;
}
