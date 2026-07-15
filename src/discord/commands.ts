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
