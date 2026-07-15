import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

export interface AdminIdentity {
  supabaseUserId: string;
  discordUserId: string;
  displayName: string;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/**
 * Authenticate a dashboard request using the caller's Supabase access token
 * (obtained via Supabase Discord OAuth). Returns the linked Discord identity,
 * which is how org membership is keyed. Returns null when unauthenticated.
 */
export async function authenticate(
  env: Env,
  request: Request,
): Promise<AdminIdentity | null> {
  const token = bearer(request);
  if (!token) return null;

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;

  const user = data.user;
  const identity = (user.identities ?? []).find(
    (item) => item.provider === "discord",
  );
  const discordUserId =
    (identity?.id as string | undefined) ??
    (user.user_metadata?.provider_id as string | undefined) ??
    (user.user_metadata?.sub as string | undefined);
  if (!discordUserId) return null;

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "admin";

  return { supabaseUserId: user.id, discordUserId, displayName };
}
