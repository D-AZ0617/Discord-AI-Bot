import type { DiscordEmbed } from "./interactions.js";

const DISCORD_API = "https://discord.com/api/v10";

export interface EditedMessage {
  id: string;
  channel_id: string;
}

interface MessagePayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

function body(payload: MessagePayload): string {
  return JSON.stringify({ ...payload, allowed_mentions: { parse: [] } });
}

async function ensureOk(response: Response, action: string): Promise<Response> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Discord ${action} failed: ${response.status} ${detail.slice(0, 300)}`,
    );
  }
  return response;
}

/**
 * Edit the original deferred interaction reply. Interaction webhook tokens are
 * valid for ~15 minutes, so this is used for the first status update.
 */
export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  payload: MessagePayload,
): Promise<EditedMessage> {
  const response = await ensureOk(
    await fetch(
      `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: body(payload),
      },
    ),
    "edit original response",
  );
  return (await response.json()) as EditedMessage;
}

/**
 * Edit a channel message using the bot token. Used for long-running agents once
 * the interaction token has expired.
 */
export async function editChannelMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  payload: MessagePayload,
): Promise<void> {
  await ensureOk(
    await fetch(
      `${DISCORD_API}/channels/${channelId}/messages/${messageId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bot ${botToken}`,
        },
        body: body(payload),
      },
    ),
    "edit channel message",
  );
}

/** Register global application (slash) commands. Overwrites the full set. */
export async function overwriteGlobalCommands(
  applicationId: string,
  botToken: string,
  commands: unknown[],
): Promise<void> {
  await ensureOk(
    await fetch(`${DISCORD_API}/applications/${applicationId}/commands`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify(commands),
    }),
    "register global commands",
  );
}
