import { AgentProviderRegistry } from "../registry.js";
import { cursorProviderDefinition } from "./cursor.js";
import { chatProviderDefinitions } from "./chat.js";

/**
 * The set of provider definitions available to every tenant: Cursor cloud
 * agents (repo work + PRs), OpenRouter chat and codebase Q&A, plus chat
 * models (OpenAI, Anthropic, Google). All share the provider-neutral contract.
 */
export function defaultProviderRegistry(): AgentProviderRegistry {
  return new AgentProviderRegistry([
    cursorProviderDefinition,
    ...chatProviderDefinitions,
  ]);
}
