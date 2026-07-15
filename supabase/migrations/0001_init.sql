-- Multi-tenant schema for the hosted Discord agent bot.
--
-- Security model: every application access goes through the Cloudflare Worker
-- using the Supabase *service role*, which scopes every query by org_id. Row
-- Level Security is enabled on every table with NO permissive policies, so the
-- anon/authenticated keys used in browsers cannot read or write any row -- most
-- importantly they can never read encrypted provider credentials.

create extension if not exists "pgcrypto";

-- Tenants ------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table organization_members (
  org_id uuid not null references organizations (id) on delete cascade,
  user_id text not null,               -- Discord user id
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table guild_installations (
  guild_id text primary key,           -- Discord guild id (one org per guild)
  org_id uuid not null references organizations (id) on delete cascade,
  installed_by text,
  created_at timestamptz not null default now()
);
create index guild_installations_org_idx on guild_installations (org_id);

-- Configuration ------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  guild_id text not null,
  name text not null,
  display_name text,
  channel_ids text[] not null default '{}',
  allowed_role_ids text[] not null default '{}',
  provider text not null default 'cursor',
  provider_options jsonb not null default '{}'::jsonb,
  repo_url text not null,
  default_branch text,
  auto_create_pr boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create index projects_guild_idx on projects (guild_id);

-- Encrypted BYOK credentials (ciphertext only; keys live in Cloudflare) -----
create table provider_credentials (
  org_id uuid not null references organizations (id) on delete cascade,
  provider_id text not null,
  ciphertext text not null,
  iv text not null,
  key_version integer not null,
  base_url text,
  updated_at timestamptz not null default now(),
  primary key (org_id, provider_id)
);

-- Context <-> agent mapping ------------------------------------------------
create table context_agents (
  org_id uuid not null references organizations (id) on delete cascade,
  context_id text not null,
  project_name text not null,
  provider_id text not null,
  agent_id text not null,
  guild_id text not null,
  route_channel_id text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, context_id, project_name, provider_id)
);

-- Runs ---------------------------------------------------------------------
create table runs (
  org_id uuid not null references organizations (id) on delete cascade,
  run_id text not null,
  provider_id text not null,
  agent_id text not null,
  context_id text not null,
  project_name text not null,
  user_id text not null,
  discord_channel_id text not null,
  discord_message_id text,
  status text not null,
  result text,
  pr_url text,
  workflow_id text,
  created_at bigint not null,
  updated_at bigint not null,
  primary key (org_id, run_id)
);
create index runs_context_idx on runs (org_id, context_id);

-- Rate limiting ------------------------------------------------------------
create table agent_starts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  user_id text not null,
  guild_id text not null,
  project_name text not null,
  created_at bigint not null
);
create index agent_starts_lookup_idx on agent_starts (org_id, user_id, created_at);

-- Idempotency --------------------------------------------------------------
create table processed_interactions (
  interaction_id text primary key,
  created_at bigint not null
);

-- Per-context concurrency lock --------------------------------------------
create table context_locks (
  org_id uuid not null references organizations (id) on delete cascade,
  context_id text not null,
  project_name text not null,
  expires_at bigint not null,
  primary key (org_id, context_id, project_name)
);

-- Atomic rate-limit: count starts in window, insert if under the limit. -----
create or replace function try_record_agent_start(
  p_org_id uuid,
  p_user_id text,
  p_guild_id text,
  p_project_name text,
  p_since bigint,
  p_max integer,
  p_now bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
begin
  select count(*) into used
  from agent_starts
  where org_id = p_org_id and user_id = p_user_id and created_at >= p_since;

  if used >= p_max then
    return false;
  end if;

  insert into agent_starts (org_id, user_id, guild_id, project_name, created_at)
  values (p_org_id, p_user_id, p_guild_id, p_project_name, p_now);
  return true;
end;
$$;

-- Atomic lock acquire: succeed if free or expired. -------------------------
create or replace function try_acquire_context_lock(
  p_org_id uuid,
  p_context_id text,
  p_project_name text,
  p_expires_at bigint,
  p_now bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into context_locks (org_id, context_id, project_name, expires_at)
  values (p_org_id, p_context_id, p_project_name, p_expires_at)
  on conflict (org_id, context_id, project_name) do update
    set expires_at = excluded.expires_at
    where context_locks.expires_at < p_now;

  return found;
end;
$$;

-- Enable RLS everywhere; deny all direct anon/authenticated access. ---------
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table guild_installations enable row level security;
alter table projects enable row level security;
alter table provider_credentials enable row level security;
alter table context_agents enable row level security;
alter table runs enable row level security;
alter table agent_starts enable row level security;
alter table processed_interactions enable row level security;
alter table context_locks enable row level security;

-- No policies are defined, so only the service role (which bypasses RLS) can
-- touch these tables. All tenant-scoped access is mediated by the Worker.

revoke execute on function try_record_agent_start(uuid, text, text, text, bigint, integer, bigint) from public;
revoke execute on function try_acquire_context_lock(uuid, text, text, bigint, bigint) from public;
grant execute on function try_record_agent_start(uuid, text, text, text, bigint, integer, bigint) to service_role;
grant execute on function try_acquire_context_lock(uuid, text, text, bigint, bigint) to service_role;
