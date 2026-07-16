import { ApplicationCommandOptionType } from "./interactions.js";

/**
 * Slash command definitions expressed as plain Discord API JSON. `/agent*` are
 * the primary commands; `/cursor*` remain as aliases for existing users.
 * These are registered globally once (not per guild) because this is one hosted
 * multi-tenant app.
 */

const promptOptions = [
  {
    name: "prompt",
    description: "What the configured AI agent should do",
    type: ApplicationCommandOptionType.STRING,
    required: true,
    max_length: 4000,
  },
  {
    name: "project",
    description: "Project slug (normally inferred from the channel)",
    type: ApplicationCommandOptionType.STRING,
    required: false,
    autocomplete: true,
  },
];

function promptCommand(name: string, description: string) {
  return { name, description, options: promptOptions, dm_permission: false };
}

function simpleCommand(name: string, description: string) {
  return { name, description, dm_permission: false };
}

const projectOption = [
  {
    name: "project",
    description: "Project slug (normally inferred from the channel)",
    type: ApplicationCommandOptionType.STRING,
    required: false,
    autocomplete: true,
  },
];

function cancelCommand(name: string, description: string) {
  return { name, description, options: projectOption, dm_permission: false };
}

/**
 * Per-prompt AI override commands. Each runs the prompt using the caller's
 * accessible project for that specific provider, for that one invocation only —
 * the channel's default project is unchanged for everyone else. Maps the slash
 * command name to the provider id it targets.
 */
export const PROVIDER_OVERRIDE_COMMANDS = new Map<string, string>([
  ["agent-cursor", "cursor"],
  ["agent-openrouter", "openrouter"],
  ["agent-chatgpt", "openai"],
  ["agent-claude", "anthropic"],
  ["agent-gemini", "google"],
]);

const providerOverrideCommands = [
  promptCommand("agent-cursor", "Run this prompt with your Cursor agent (this prompt only)"),
  promptCommand("agent-openrouter", "Run this prompt with your OpenRouter agent (this prompt only)"),
  promptCommand("agent-chatgpt", "Run this prompt with your ChatGPT agent (this prompt only)"),
  promptCommand("agent-claude", "Run this prompt with your Claude agent (this prompt only)"),
  promptCommand("agent-gemini", "Run this prompt with your Gemini agent (this prompt only)"),
];

export const commandDefinitions = [
  promptCommand(
    "agent",
    "Start or continue this channel's configured AI agent",
  ),
  promptCommand("agent-new", "Always start a new configured AI agent"),
  simpleCommand(
    "agent-status",
    "Show recent agents and runs in this channel or thread",
  ),
  simpleCommand("agent-projects", "List AI agent projects you can access"),
  cancelCommand(
    "agent-cancel",
    "Cancel the agent currently running in this channel",
  ),
  ...providerOverrideCommands,
  promptCommand("cursor", "Start an agent or continue this thread's agent"),
  promptCommand("cursor-agent", "Always start a new Cursor agent"),
  simpleCommand(
    "cursor-status",
    "Show recent agents and runs in this channel or thread",
  ),
  simpleCommand("cursor-projects", "List agent projects you can access"),
  cancelCommand(
    "cursor-cancel",
    "Cancel the agent currently running in this channel",
  ),
];

export const PROMPT_COMMANDS = new Set(["agent", "cursor"]);
export const NEW_AGENT_COMMANDS = new Set(["agent-new", "cursor-agent"]);
export const STATUS_COMMANDS = new Set(["agent-status", "cursor-status"]);
export const PROJECTS_COMMANDS = new Set(["agent-projects", "cursor-projects"]);
export const CANCEL_COMMANDS = new Set(["agent-cancel", "cursor-cancel"]);
