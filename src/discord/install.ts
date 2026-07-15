/**
 * Helpers for verifying that a dashboard admin actually manages the Discord
 * guild they are configuring, and for building the bot install URL.
 */

const DISCORD_API = "https://discord.com/api/v10";

// Permission bits: MANAGE_GUILD lets a member configure the server.
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

export interface ManageableGuild {
  id: string;
  name: string;
  icon: string | null;
}

interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner?: boolean;
  permissions?: string;
}

/**
 * List the guilds the user can manage, using their Discord OAuth provider
 * token (must have the `guilds` scope). Used to authorize onboarding.
 */
export async function listManageableGuilds(
  providerToken: string,
): Promise<ManageableGuild[]> {
  const response = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { authorization: `Bearer ${providerToken}` },
  });
  if (!response.ok) {
    throw new Error(`Discord guild lookup failed: ${response.status}`);
  }
  const guilds = (await response.json()) as DiscordGuild[];
  return guilds
    .filter((guild) => {
      if (guild.owner) return true;
      if (!guild.permissions) return false;
      const permissions = BigInt(guild.permissions);
      return (
        (permissions & MANAGE_GUILD) === MANAGE_GUILD ||
        (permissions & ADMINISTRATOR) === ADMINISTRATOR
      );
    })
    .map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon }));
}

export async function canManageGuild(
  providerToken: string,
  guildId: string,
): Promise<{ ok: boolean; name?: string }> {
  const guilds = await listManageableGuilds(providerToken);
  const match = guilds.find((guild) => guild.id === guildId);
  return match ? { ok: true, name: match.name } : { ok: false };
}

/** Build the "Add to Server" install URL for the public bot. */
export function botInstallUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: "0",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
