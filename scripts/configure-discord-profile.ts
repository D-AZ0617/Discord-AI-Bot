import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const DISCORD_API = "https://discord.com/api/v10";

function loadDevVars(): void {
  try {
    const contents = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .dev.vars is optional.
  }
}

function imageData(path: string): string {
  const mime = extname(path).toLowerCase() === ".jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

async function discordPatch(
  botToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    method: "PATCH",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Discord ${path} update failed (${response.status}): ${detail}`);
  }
}

async function main(): Promise<void> {
  loadDevVars();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN must be set in the environment or .dev.vars.");
  }

  const avatarPath = resolve(
    process.cwd(),
    process.argv[2] || "dashboard/relay-bot-avatar.png",
  );
  const avatar = imageData(avatarPath);

  await discordPatch(botToken, "/applications/@me", { icon: avatar });
  await discordPatch(botToken, "/users/@me", {
    username: "Relay Bot",
    avatar,
  });
  console.log("Discord bot profile updated to Relay Bot.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
