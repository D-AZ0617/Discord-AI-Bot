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
  const response = await fetchGuildsWithRetry(providerToken);
  if (response.status === 429) {
    throw new Error(
      "Discord is rate-limiting the server list. Wait a moment and try again.",
    );
  }
  if (response.status === 401) {
    throw new Error(
      "Your Discord session expired. Sign out and sign in again to refresh access.",
    );
  }
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

/**
 * Discord aggressively rate-limits `/users/@me/guilds`. Retry a couple of times
 * honoring the `Retry-After` header (capped) before giving up.
 */
async function fetchGuildsWithRetry(providerToken: string): Promise<Response> {
  let response = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { authorization: `Bearer ${providerToken}` },
  });
  for (let attempt = 0; attempt < 2 && response.status === 429; attempt++) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    const delayMs = Math.min(Number.isFinite(retryAfter) ? retryAfter : 1, 5) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { authorization: `Bearer ${providerToken}` },
    });
  }
  return response;
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
