/**
 * Bindings and secrets available to the Worker and Workflow.
 *
 * Secrets (set with `wrangler secret put`) never live in the repo. Non-secret
 * values live in `wrangler.toml` under `[vars]`.
 */
export interface Env {
  // Discord application credentials.
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;

  // Supabase project. Service-role key is a secret and only used server-side.
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;

  // Comma-separated `version:base64key` entries for BYOK envelope encryption.
  // The highest version is used to encrypt; all are available to decrypt.
  CREDENTIAL_ENCRYPTION_KEYS: string;

  // Public base URL of the deployed dashboard/worker (for OAuth redirects).
  PUBLIC_BASE_URL: string;

  // Operational tuning (strings because wrangler vars are strings).
  NEW_AGENTS_PER_USER_PER_HOUR?: string;
  POLL_INTERVAL_MS?: string;
  AGENT_TIMEOUT_MINUTES?: string;

  // Durable execution binding for agent runs.
  RUN_AGENT_WORKFLOW: Workflow<import("./workflows/run-agent.js").RunAgentParams>;

  // Static assets binding for the dashboard.
  ASSETS: Fetcher;
}

export interface RuntimeConfig {
  newAgentsPerUserPerHour: number;
  pollIntervalMs: number;
  agentTimeoutMinutes: number;
}

export function runtimeConfig(env: Env): RuntimeConfig {
  return {
    newAgentsPerUserPerHour: positiveInt(env.NEW_AGENTS_PER_USER_PER_HOUR, 5),
    pollIntervalMs: positiveInt(env.POLL_INTERVAL_MS, 5_000),
    agentTimeoutMinutes: positiveInt(env.AGENT_TIMEOUT_MINUTES, 120),
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
