import { AgentProviderRegistry } from "../registry.js";
import { cursorProviderDefinition } from "./cursor.js";
import { chatProviderDefinitions } from "./chat.js";

/**
 * The set of provider definitions available to every tenant: Cursor cloud
 * agents (repo work + PRs) plus chat models (OpenAI, Anthropic, Google, and
 * OpenRouter's free models). All share the provider-neutral contract.
 */
export function defaultProviderRegistry(): AgentProviderRegistry {
  return new AgentProviderRegistry([
    cursorProviderDefinition,
    ...chatProviderDefinitions,
  ]);
}
