/**
 * Registers global slash commands with Discord. Run once after deploying, and
 * again whenever `src/discord/commands.ts` changes.
 *
 *   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npm run register-commands
 *
 * Values can also be provided via a local `.dev.vars` file (see README).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commandDefinitions } from "../src/discord/commands.js";
import { overwriteGlobalCommands } from "../src/discord/rest.js";

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

async function main(): Promise<void> {
  loadDevVars();
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!applicationId || !botToken) {
    throw new Error(
      "DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set (env or .dev.vars).",
    );
  }
  await overwriteGlobalCommands(applicationId, botToken, commandDefinitions);
  console.log(`Registered ${commandDefinitions.length} global commands.`);
}

main().catch((error) => {
  console.error("Command registration failed:", error);
  process.exit(1);
});
