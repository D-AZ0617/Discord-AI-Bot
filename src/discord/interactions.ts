/**
 * Minimal Discord interaction typings and response builders. We deliberately
 * avoid discord.js: the Worker only speaks raw HTTP JSON, which keeps the bundle
 * tiny and edge-friendly.
 *
 * Reference: https://discord.com/developers/docs/interactions/receiving-and-responding
 */

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
} as const;

/** Message flag marking a reply as ephemeral (only visible to the caller). */
export const EPHEMERAL_FLAG = 1 << 6;

export const ApplicationCommandOptionType = {
  STRING: 3,
} as const;

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  timestamp?: string;
  fields?: DiscordEmbedField[];
}

export interface InteractionMember {
  roles?: string[];
  user?: InteractionUser;
}

export interface InteractionUser {
  id: string;
  username?: string;
}

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
  options?: InteractionOption[];
}

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id: string; type: number; parent_id?: string | null };
  member?: InteractionMember;
  user?: InteractionUser;
  data?: {
    id: string;
    name: string;
    options?: InteractionOption[];
  };
}

export function getStringOption(
  interaction: DiscordInteraction,
  name: string,
): string | null {
  const option = interaction.data?.options?.find((item) => item.name === name);
  if (!option || typeof option.value !== "string") return null;
  return option.value;
}

export function getFocusedOption(
  interaction: DiscordInteraction,
): InteractionOption | null {
  return (
    interaction.data?.options?.find((option) => option.focused) ?? null
  );
}

export function callerUserId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

export function callerUsername(interaction: DiscordInteraction): string {
  return (
    interaction.member?.user?.username ??
    interaction.user?.username ??
    "unknown"
  );
}

export function callerRoleIds(interaction: DiscordInteraction): string[] {
  return interaction.member?.roles ?? [];
}

/** Channel type 11/12 are public/private threads. */
export function routeChannelId(interaction: DiscordInteraction): string {
  const channel = interaction.channel;
  if (
    channel &&
    (channel.type === 11 || channel.type === 12) &&
    channel.parent_id
  ) {
    return channel.parent_id;
  }
  return interaction.channel_id ?? channel?.id ?? "";
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function pong(): Response {
  return jsonResponse({ type: InteractionResponseType.PONG });
}

export function ephemeralMessage(content: string): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL_FLAG, allowed_mentions: { parse: [] } },
  });
}

export function ephemeralEmbed(embed: DiscordEmbed): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [embed],
      flags: EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
    },
  });
}

export function deferredPublic(): Response {
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
}

export function deferredEphemeral(): Response {
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: EPHEMERAL_FLAG },
  });
}

export function autocompleteResult(
  choices: Array<{ name: string; value: string }>,
): Response {
  return jsonResponse({
    type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
    data: { choices: choices.slice(0, 25) },
  });
}
