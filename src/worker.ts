import { defaultProviderRegistry } from "./agents/providers/index.js";
import { handleAdminRequest } from "./admin/routes.js";
import { CommandRouter } from "./bot/handlers.js";
import { createServiceClient, SupabaseStore } from "./db/supabase-store.js";
import {
  importDiscordPublicKey,
  verifyDiscordRequest,
} from "./discord/verify.js";
import {
  InteractionType,
  pong,
  type DiscordInteraction,
} from "./discord/interactions.js";
import { runtimeConfig, type Env } from "./env.js";

export { RunAgentWorkflow } from "./workflows/run-agent.js";

let cachedKey: { hex: string; key: Promise<CryptoKey> } | null = null;

function discordPublicKey(publicKeyHex: string): Promise<CryptoKey> {
  if (!cachedKey || cachedKey.hex !== publicKeyHex) {
    cachedKey = { hex: publicKeyHex, key: importDiscordPublicKey(publicKeyHex) };
  }
  return cachedKey.key;
}

async function handleInteractions(
  request: Request,
  env: Env,
): Promise<Response> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await request.text();

  const key = await discordPublicKey(env.DISCORD_PUBLIC_KEY);
  const valid = await verifyDiscordRequest(key, signature, timestamp, rawBody);
  if (!valid) return new Response("Bad request signature", { status: 401 });

  const interaction = JSON.parse(rawBody) as DiscordInteraction;
  if (interaction.type === InteractionType.PING) return pong();

  const store = new SupabaseStore(createServiceClient(env));
  const registry = defaultProviderRegistry();
  const router = new CommandRouter(env, store, registry, runtimeConfig(env));

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    return router.handleCommand(interaction);
  }
  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    return router.handleAutocomplete(interaction);
  }
  return new Response("Unsupported interaction", { status: 400 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/interactions" && request.method === "POST") {
      return handleInteractions(request, env);
    }

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Public bootstrap config for the browser dashboard (only public values).
    if (url.pathname === "/api/public-config" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          supabaseUrl: env.SUPABASE_URL,
          supabaseAnonKey: env.SUPABASE_ANON_KEY,
          installUrl: `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&scope=bot+applications.commands&permissions=0`,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname.startsWith("/api/")) {
      return handleAdminRequest(request, env, url);
    }

    // Everything else is the static onboarding dashboard.
    return env.ASSETS.fetch(request);
  },
};
