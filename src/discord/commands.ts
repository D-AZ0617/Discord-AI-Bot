import { ApplicationCommandOptionType } from "./interactions.js";

/**
 * Slash command definitions. `/agent*` are primary; `/cursor*` remain as
 * aliases. One Agent per channel — no per-prompt provider overrides.
 */

const promptOption = [
  {
    name: "prompt",
    description: "What this channel's AI agent should do",
    type: ApplicationCommandOptionType.STRING,
    required: true,
    max_length: 4000,
  },
];

function promptCommand(name: string, description: string) {
  return { name, description, options: promptOption, dm_permission: false };
}

function simpleCommand(name: string, description: string) {
  return { name, description, dm_permission: false };
}

export const commandDefinitions = [
  promptCommand("agent", "Ask this channel's configured AI agent"),
  promptCommand("agent-new", "Start a fresh run with this channel's AI agent"),
  simpleCommand(
    "agent-status",
    "Show recent agent runs in this channel or thread",
  ),
  simpleCommand("agent-list", "List AI agents you can access in this server"),
  simpleCommand(
    "agent-cancel",
    "Cancel the agent currently running in this channel",
  ),
  promptCommand("cursor", "Ask this channel's configured AI agent"),
  promptCommand("cursor-agent", "Start a fresh run with this channel's AI agent"),
  simpleCommand(
    "cursor-status",
    "Show recent agent runs in this channel or thread",
  ),
  simpleCommand("cursor-list", "List AI agents you can access in this server"),
  simpleCommand(
    "cursor-cancel",
    "Cancel the agent currently running in this channel",
  ),
];

export const PROMPT_COMMANDS = new Set(["agent", "cursor"]);
export const NEW_AGENT_COMMANDS = new Set(["agent-new", "cursor-agent"]);
export const STATUS_COMMANDS = new Set(["agent-status", "cursor-status"]);
export const LIST_COMMANDS = new Set(["agent-list", "cursor-list"]);
/** @deprecated Kept for older interaction caches during rollout. */
export const PROJECTS_COMMANDS = new Set([
  "agent-projects",
  "cursor-projects",
  ...LIST_COMMANDS,
]);
export const CANCEL_COMMANDS = new Set(["agent-cancel", "cursor-cancel"]);
