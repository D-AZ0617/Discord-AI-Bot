import { defaultProviderRegistry } from "../agents/providers/index.js";
import { loadKeyRing } from "../credentials/encrypt.js";
import { CredentialResolver } from "../credentials/resolver.js";
import { createServiceClient, SupabaseStore } from "../db/supabase-store.js";
import type { StoredProject } from "../db/types.js";
import { validateProjectInput } from "../config/schema.js";
import { authenticate, type AdminIdentity } from "../auth/session.js";
import {
  botInstallUrl,
  canManageGuild,
  listManageableGuilds,
} from "../discord/install.js";
import { fetchGuildChannels, fetchGuildRoles } from "../discord/guild.js";
import type { Env } from "../env.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Dashboard/admin API. Every route requires a valid Supabase session and scopes
 * all data access to organizations the caller belongs to.
 */
export async function handleAdminRequest(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const identity = await authenticate(env, request);
  if (!identity) return json({ error: "Unauthorized" }, 401);

  const store = new SupabaseStore(createServiceClient(env));
  const path = url.pathname;
  const method = request.method;

  try {
    if (path === "/api/me" && method === "GET") {
      const orgs = await store.listOrgsForUser(identity.discordUserId);
      return json({
        discordUserId: identity.discordUserId,
        displayName: identity.displayName,
        installUrl: botInstallUrl(env.DISCORD_CLIENT_ID),
        orgs,
      });
    }

    if (path === "/api/guilds" && method === "GET") {
      const providerToken = request.headers.get("x-discord-provider-token");
      if (!providerToken) return json({ error: "Missing Discord token" }, 400);
      const guilds = await listManageableGuilds(providerToken);
      const orgs = await store.listOrgsForUser(identity.discordUserId);
      const installations = (
        await Promise.all(orgs.map((org) => store.listInstallationsForOrg(org.id)))
      ).flat();
      const orgByGuild = new Map(
        installations.map((installation) => [
          installation.guildId,
          installation.orgId,
        ]),
      );
      const guildsWithStatus = await Promise.all(
        guilds.map(async (guild) => {
          const orgId = orgByGuild.get(guild.id) ?? null;
          if (!orgId) return { ...guild, orgId: null };
          try {
            await fetchGuildRoles(env.DISCORD_BOT_TOKEN, guild.id);
            return { ...guild, orgId };
          } catch {
            // A stale database installation is not enough to call a server
            // configured; the bot must still be a member of the Discord guild.
            return { ...guild, orgId: null };
          }
        }),
      );
      return json({
        guilds: guildsWithStatus,
      });
    }

    if (path === "/api/install" && method === "POST") {
      const body = await readJson(request);
      const guildId = String(body.guildId ?? "");
      const guildName = String(body.guildName ?? "New server");
      const providerToken = String(body.providerToken ?? "");
      if (!guildId || !providerToken) {
        return json({ error: "guildId and providerToken are required" }, 400);
      }
      const manage = await canManageGuild(providerToken, guildId);
      if (!manage.ok) {
        return json({ error: "You cannot manage that server." }, 403);
      }
      try {
        await fetchGuildRoles(env.DISCORD_BOT_TOKEN, guildId);
      } catch {
        return json(
          {
            error:
              "Relay is not installed in that server yet. Click “Add to Discord,” install Relay, then try Configure again.",
          },
          409,
        );
      }

      const existing = await store.getInstallationByGuild(guildId);
      let orgId: string;
      if (existing) {
        orgId = existing.orgId;
        await store.addMember(orgId, identity.discordUserId, "admin");
      } else {
        const org = await store.createOrganization(manage.name ?? guildName);
        orgId = org.id;
        await store.addMember(orgId, identity.discordUserId, "admin");
        await store.createInstallation(guildId, orgId, identity.discordUserId);
      }
      return json({ orgId });
    }

    // Remaining routes operate on an org the caller must belong to.
    const orgId = url.searchParams.get("orgId") ?? undefined;
    if (path === "/api/guild-meta" && method === "GET") {
      const org = await requireMember(store, identity, orgId);
      if (!org.ok) return org.response;
      const guildId = url.searchParams.get("guildId") ?? "";
      const installation = await store.getInstallationByGuild(guildId);
      if (!installation || installation.orgId !== org.orgId) {
        return json({ error: "That guild is not installed under this org." }, 403);
      }
      const [rolesResult, channelsResult] = await Promise.allSettled([
        fetchGuildRoles(env.DISCORD_BOT_TOKEN, guildId),
        fetchGuildChannels(env.DISCORD_BOT_TOKEN, guildId),
      ]);
      if (rolesResult.status === "rejected" && channelsResult.status === "rejected") {
        return json(
          {
            error:
              "Relay could not access this server. Add Relay to the server, then reload this page.",
          },
          502,
        );
      }
      const warnings = [
        ...(rolesResult.status === "rejected"
          ? ["Relay could not load server roles. Check the bot installation and permissions."]
          : []),
        ...(channelsResult.status === "rejected"
          ? ["Relay could not load server channels. Check the bot's channel visibility."]
          : []),
      ];
      return json({
        roles: rolesResult.status === "fulfilled" ? rolesResult.value : [],
        channels: channelsResult.status === "fulfilled" ? channelsResult.value : [],
        warnings,
      });
    }

    if (path === "/api/projects" && method === "GET") {
      const org = await requireMember(store, identity, orgId);
      if (!org.ok) return org.response;
      return json({ projects: await store.listProjects(org.orgId) });
    }

    if (path === "/api/projects" && method === "POST") {
      const body = await readJson(request);
      const bodyOrgId = String(body.orgId ?? "");
      const org = await requireMember(store, identity, bodyOrgId);
      if (!org.ok) return org.response;
      return handleProjectUpsert(store, org.orgId, body.project);
    }

    if (path === "/api/projects" && method === "DELETE") {
      const org = await requireMember(store, identity, orgId);
      if (!org.ok) return org.response;
      const name = url.searchParams.get("name");
      if (!name) return json({ error: "name is required" }, 400);
      await store.deleteProject(org.orgId, name);
      return json({ ok: true });
    }

    if (path === "/api/credentials" && method === "GET") {
      const org = await requireMember(store, identity, orgId);
      if (!org.ok) return org.response;
      return json({
        providers: await store.listConfiguredProviderIds(org.orgId),
      });
    }

    if (path === "/api/credentials" && method === "POST") {
      const body = await readJson(request);
      const org = await requireMember(store, identity, String(body.orgId ?? ""));
      if (!org.ok) return org.response;
      return handleCredentialUpsert(env, store, org.orgId, body);
    }

    if (path === "/api/credentials" && method === "DELETE") {
      const org = await requireMember(store, identity, orgId);
      if (!org.ok) return org.response;
      const providerId = url.searchParams.get("providerId");
      if (!providerId) return json({ error: "providerId is required" }, 400);
      await store.deleteCredential(org.orgId, providerId);
      return json({ ok: true });
    }

    if (path === "/api/credentials/test" && method === "POST") {
      const body = await readJson(request);
      const org = await requireMember(store, identity, String(body.orgId ?? ""));
      if (!org.ok) return org.response;
      return handleCredentialTest(env, store, org.orgId, String(body.providerId ?? ""));
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
}

type MemberCheck =
  | { ok: true; orgId: string }
  | { ok: false; response: Response };

async function requireMember(
  store: SupabaseStore,
  identity: AdminIdentity,
  orgId: string | undefined,
): Promise<MemberCheck> {
  if (!orgId) return { ok: false, response: json({ error: "orgId is required" }, 400) };
  const member = await store.isMember(orgId, identity.discordUserId);
  if (!member) return { ok: false, response: json({ error: "Forbidden" }, 403) };
  return { ok: true, orgId };
}

async function handleProjectUpsert(
  store: SupabaseStore,
  orgId: string,
  rawProject: unknown,
): Promise<Response> {
  const validation = validateProjectInput(rawProject);
  if (!validation.ok || !validation.project) {
    return json({ error: "Invalid project", details: validation.errors }, 400);
  }
  const project = validation.project;

  // The project's guild must belong to this org's installations.
  const installation = await store.getInstallationByGuild(project.guildId);
  if (!installation || installation.orgId !== orgId) {
    return json({ error: "That guild is not installed under this org." }, 403);
  }

  const registry = defaultProviderRegistry();
  const capabilityErrors = registry.validateProject(project);
  if (capabilityErrors.length > 0) {
    return json({ error: "Invalid project", details: capabilityErrors }, 400);
  }

  const stored: StoredProject = { ...project, orgId };
  await store.upsertProject(stored);
  return json({ ok: true, project: stored });
}

async function handleCredentialUpsert(
  env: Env,
  store: SupabaseStore,
  orgId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const providerId = String(body.providerId ?? "");
  const apiKey = String(body.apiKey ?? "");
  const baseUrl =
    typeof body.baseUrl === "string" && body.baseUrl.trim()
      ? body.baseUrl.trim()
      : undefined;
  const registry = defaultProviderRegistry();
  if (!registry.has(providerId)) {
    return json({ error: `Unknown provider: ${providerId}` }, 400);
  }
  if (!apiKey) return json({ error: "apiKey is required" }, 400);

  const keyRing = await loadKeyRing(env.CREDENTIAL_ENCRYPTION_KEYS);
  const resolver = new CredentialResolver(store, registry, keyRing);
  const encrypted = await resolver.encrypt(apiKey);
  await store.upsertCredential({
    orgId,
    providerId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    keyVersion: encrypted.keyVersion,
    ...(baseUrl ? { baseUrl } : {}),
  });
  return json({ ok: true });
}

async function handleCredentialTest(
  env: Env,
  store: SupabaseStore,
  orgId: string,
  providerId: string,
): Promise<Response> {
  const registry = defaultProviderRegistry();
  if (!registry.has(providerId)) {
    return json({ error: `Unknown provider: ${providerId}` }, 400);
  }
  const keyRing = await loadKeyRing(env.CREDENTIAL_ENCRYPTION_KEYS);
  const resolver = new CredentialResolver(store, registry, keyRing);
  try {
    const provider = await resolver.providerFor(orgId, providerId);
    if (provider.verifyCredential) {
      await provider.verifyCredential();
    }
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 200);
  }
}
