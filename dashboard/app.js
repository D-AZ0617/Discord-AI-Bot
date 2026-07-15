import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const app = document.getElementById("app");
const accountEl = document.getElementById("account");
const toastEl = document.getElementById("toast");

let supabase = null;
let config = null;
let session = null;
let state = { orgId: null };

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.toggle("error", isError);
  setTimeout(() => (toastEl.hidden = true), 3500);
}

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${session.access_token}`,
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function providerToken() {
  return session?.provider_token || sessionStorage.getItem("discord_provider_token") || "";
}

async function boot() {
  config = await (await fetch("/api/public-config")).json();
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, detectSessionInUrl: true },
  });

  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session?.provider_token) {
    sessionStorage.setItem("discord_provider_token", session.provider_token);
  }

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    if (newSession?.provider_token) {
      sessionStorage.setItem("discord_provider_token", newSession.provider_token);
    }
    render();
  });

  render();
}

function renderAccount() {
  if (!session) {
    accountEl.innerHTML = "";
    return;
  }
  accountEl.innerHTML = "";
  const name = el(`<span>Signed in</span>`);
  const signOut = el(`<button class="btn-ghost">Sign out</button>`);
  signOut.onclick = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem("discord_provider_token");
    state = { orgId: null };
  };
  accountEl.append(name, signOut);
}

function render() {
  renderAccount();
  if (!session) return renderLogin();
  if (!state.orgId) return renderServers();
  return renderOrg();
}

function renderLogin() {
  app.innerHTML = "";
  const card = el(`
    <section class="card hero">
      <h1>Connect Cursor agents to your Discord</h1>
      <p>Install the bot, map channels to GitHub repos, and let your team start
      cloud agents with <code>/agent</code>. Bring your own provider key.</p>
    </section>
  `);
  const btn = el(`<button class="btn-primary">Sign in with Discord</button>`);
  btn.onclick = () =>
    supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { scopes: "identify guilds", redirectTo: window.location.origin },
    });
  card.append(btn);
  app.append(card);
}

async function renderServers() {
  app.innerHTML = "";
  const intro = el(`
    <section class="card">
      <h2>1. Add the bot to your server</h2>
      <p class="hint">Invite the bot, then pick a server you manage to configure it.</p>
    </section>
  `);
  const install = el(`<a href="${config.installUrl}" target="_blank" rel="noopener"><button class="btn-primary">Add to Discord</button></a>`);
  intro.append(install);
  app.append(intro);

  const listCard = el(`
    <section class="card">
      <h2>2. Choose a server to configure</h2>
      <p class="hint">Servers where you have “Manage Server”.</p>
      <div class="list" id="guilds"><p class="muted">Loading servers…</p></div>
    </section>
  `);
  app.append(listCard);

  const guildsEl = listCard.querySelector("#guilds");
  const token = providerToken();
  if (!token) {
    guildsEl.innerHTML = `<p class="muted">Re-sign in to grant server access.</p>`;
    return;
  }
  try {
    const { guilds } = await api("/api/guilds", {
      headers: { "x-discord-provider-token": token },
    });
    guildsEl.innerHTML = "";
    if (guilds.length === 0) {
      guildsEl.innerHTML = `<p class="muted">No manageable servers found.</p>`;
      return;
    }
    for (const guild of guilds) {
      const item = el(`
        <div class="item">
          <div><strong>${escapeHtml(guild.name)}</strong>
          <div class="meta">${guild.id}</div></div>
        </div>
      `);
      const configure = el(`<button class="btn-primary">Configure</button>`);
      configure.onclick = async () => {
        configure.disabled = true;
        try {
          const { orgId } = await api("/api/install", {
            method: "POST",
            body: JSON.stringify({
              guildId: guild.id,
              guildName: guild.name,
              providerToken: token,
            }),
          });
          state = { orgId, guildId: guild.id, guildName: guild.name };
          render();
        } catch (error) {
          toast(error.message, true);
          configure.disabled = false;
        }
      };
      item.append(configure);
      guildsEl.append(item);
    }
  } catch (error) {
    guildsEl.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

async function renderOrg() {
  app.innerHTML = "";
  const back = el(`<button class="btn-ghost">← Back to servers</button>`);
  back.onclick = () => {
    state = { orgId: null };
    render();
  };
  app.append(back);

  await renderCredentials();
  await renderProjects();
}

async function renderCredentials() {
  const card = el(`
    <section class="card">
      <h2>Provider keys</h2>
      <p class="hint">Your API key is encrypted before storage and never shown again.</p>
      <div id="cred-status" class="list"></div>
      <div class="divider"></div>
      <label>Provider</label>
      <select id="cred-provider"><option value="cursor">Cursor Cloud Agents</option></select>
      <label>API key</label>
      <input id="cred-key" type="password" placeholder="key_..." autocomplete="off" />
      <div class="actions">
        <button class="btn-primary" id="cred-save">Save key</button>
        <button class="btn-ghost" id="cred-test">Test connection</button>
      </div>
    </section>
  `);
  app.append(card);

  const refresh = async () => {
    const statusEl = card.querySelector("#cred-status");
    try {
      const { providers } = await api(`/api/credentials?orgId=${state.orgId}`);
      statusEl.innerHTML = providers.length
        ? providers
            .map((p) => `<div class="item"><span>${escapeHtml(p)}</span><span class="pill ok">configured</span></div>`)
            .join("")
        : `<p class="muted">No provider keys configured yet.</p>`;
    } catch (error) {
      statusEl.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  };

  card.querySelector("#cred-save").onclick = async () => {
    const providerId = card.querySelector("#cred-provider").value;
    const apiKey = card.querySelector("#cred-key").value.trim();
    if (!apiKey) return toast("Enter an API key", true);
    try {
      await api("/api/credentials", {
        method: "POST",
        body: JSON.stringify({ orgId: state.orgId, providerId, apiKey }),
      });
      card.querySelector("#cred-key").value = "";
      toast("Key saved");
      refresh();
    } catch (error) {
      toast(error.message, true);
    }
  };

  card.querySelector("#cred-test").onclick = async () => {
    const providerId = card.querySelector("#cred-provider").value;
    try {
      const result = await api("/api/credentials/test", {
        method: "POST",
        body: JSON.stringify({ orgId: state.orgId, providerId }),
      });
      toast(result.ok ? "Connection OK" : `Failed: ${result.error}`, !result.ok);
    } catch (error) {
      toast(error.message, true);
    }
  };

  await refresh();
}

async function renderProjects() {
  const card = el(`
    <section class="card">
      <h2>Projects</h2>
      <p class="hint">Map a channel (or the whole server) and roles to a GitHub repo.</p>
      <div id="project-list" class="list"></div>
      <div class="divider"></div>
      <div class="row">
        <div><label>Slug</label><input id="p-name" placeholder="website" /></div>
        <div><label>Display name</label><input id="p-display" placeholder="Website" /></div>
      </div>
      <label>GitHub repo URL</label>
      <input id="p-repo" placeholder="https://github.com/owner/repo" />
      <div class="row">
        <div><label>Default branch (optional)</label><input id="p-branch" placeholder="main" /></div>
        <div><label>Provider</label><input id="p-provider" value="cursor" /></div>
      </div>
      <label>Channel IDs (comma separated, blank = whole server)</label>
      <input id="p-channels" placeholder="123456789012345678" />
      <label>Allowed role IDs (comma separated)</label>
      <input id="p-roles" placeholder="123456789012345678" />
      <label><input type="checkbox" id="p-pr" checked style="width:auto;margin-right:8px" />Auto-create pull requests</label>
      <div class="actions">
        <button class="btn-primary" id="p-save">Save project</button>
      </div>
    </section>
  `);
  app.append(card);

  const listEl = card.querySelector("#project-list");
  const refresh = async () => {
    try {
      const { projects } = await api(`/api/projects?orgId=${state.orgId}`);
      listEl.innerHTML = "";
      if (projects.length === 0) {
        listEl.innerHTML = `<p class="muted">No projects yet.</p>`;
        return;
      }
      for (const project of projects) {
        const scope = project.channelIds.length ? `${project.channelIds.length} channel(s)` : "whole server";
        const item = el(`
          <div class="item">
            <div>
              <strong>${escapeHtml(project.displayName || project.name)}</strong>
              <span class="pill">${escapeHtml(project.provider)}</span>
              <div class="meta">${escapeHtml(project.repoUrl)} · ${scope}</div>
            </div>
          </div>
        `);
        const del = el(`<button class="btn-danger">Remove</button>`);
        del.onclick = async () => {
          try {
            await api(`/api/projects?orgId=${state.orgId}&name=${encodeURIComponent(project.name)}`, {
              method: "DELETE",
            });
            refresh();
          } catch (error) {
            toast(error.message, true);
          }
        };
        item.append(del);
        listEl.append(item);
      }
    } catch (error) {
      listEl.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  };

  card.querySelector("#p-save").onclick = async () => {
    const splitIds = (value) =>
      value.split(",").map((s) => s.trim()).filter(Boolean);
    const project = {
      name: card.querySelector("#p-name").value.trim(),
      displayName: card.querySelector("#p-display").value.trim() || undefined,
      guildId: state.guildId,
      repoUrl: card.querySelector("#p-repo").value.trim(),
      defaultBranch: card.querySelector("#p-branch").value.trim() || undefined,
      provider: card.querySelector("#p-provider").value.trim() || "cursor",
      channelIds: splitIds(card.querySelector("#p-channels").value),
      allowedRoleIds: splitIds(card.querySelector("#p-roles").value),
      autoCreatePR: card.querySelector("#p-pr").checked,
    };
    try {
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({ orgId: state.orgId, project }),
      });
      toast("Project saved");
      card.querySelector("#p-name").value = "";
      refresh();
    } catch (error) {
      toast(error.message, true);
    }
  };

  await refresh();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

boot().catch((error) => {
  app.innerHTML = `<section class="card"><p>Failed to load: ${escapeHtml(error.message)}</p></section>`;
});
