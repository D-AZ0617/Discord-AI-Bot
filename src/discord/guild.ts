const DISCORD_API = "https://discord.com/api/v10";

export interface GuildRole {
  id: string;
  name: string;
  managed: boolean;
}

export interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}

/** Channel types where slash commands are usable. */
const TEXT_CHANNEL_TYPES = new Set([
  0, // GUILD_TEXT
  5, // GUILD_ANNOUNCEMENT
  15, // GUILD_FORUM
  16, // GUILD_MEDIA
]);

interface RawRole {
  id: string;
  name: string;
  managed?: boolean;
  position?: number;
}

interface RawChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  position?: number;
}

async function botFetch(
  botToken: string,
  path: string,
  action: string,
): Promise<unknown> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    headers: { authorization: `Bot ${botToken}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Discord ${action} failed: ${response.status} ${detail.slice(0, 200)}`,
    );
  }
  return response.json();
}

/**
 * Roles the guild has, excluding @everyone (whose id equals the guild id).
 * Highest roles first for a natural picker order.
 */
export async function fetchGuildRoles(
  botToken: string,
  guildId: string,
): Promise<GuildRole[]> {
  const raw = (await botFetch(
    botToken,
    `/guilds/${guildId}/roles`,
    "list roles",
  )) as RawRole[];
  return raw
    .filter((role) => role.id !== guildId)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
    .map((role) => ({
      id: role.id,
      name: role.name,
      managed: Boolean(role.managed),
    }));
}

/** Text-capable channels the guild has, in display order. */
export async function fetchGuildChannels(
  botToken: string,
  guildId: string,
): Promise<GuildChannel[]> {
  const raw = (await botFetch(
    botToken,
    `/guilds/${guildId}/channels`,
    "list channels",
  )) as RawChannel[];
  return raw
    .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parent_id ?? null,
    }));
}
