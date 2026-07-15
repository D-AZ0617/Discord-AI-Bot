import { AgentProviderRegistry } from "../registry.js";
import { cursorProviderDefinition } from "./cursor.js";

/**
 * The set of provider definitions available to every tenant. Add Gemini,
 * OpenAI, or Anthropic definitions here as adapters are implemented; the
 * provider-neutral contracts mean nothing else needs to change.
 */
export function defaultProviderRegistry(): AgentProviderRegistry {
  return new AgentProviderRegistry([cursorProviderDefinition]);
}
