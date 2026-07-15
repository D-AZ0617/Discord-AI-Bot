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

function projectSlug(displayName, existingNames) {
  const base =
    displayName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/g, "") || "project";

  if (!existingNames.has(base)) return base;
  for (let number = 2; ; number += 1) {
    const suffix = `-${number}`;
    const candidate = `${base.slice(0, 32 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!existingNames.has(candidate)) return candidate;
  }
}

function uniqueProjectDisplayName(displayName, projects) {
  const usedNames = new Set(
    projects.map((project) =>
      (project.displayName || project.name).trim().toLowerCase(),
    ),
  );
  if (!usedNames.has(displayName.toLowerCase())) return displayName;
  for (let number = 2; ; number += 1) {
    const candidate = `${displayName} ${number}`;
    if (!usedNames.has(candidate.toLowerCase())) return candidate;
  }
}

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${session.access_token}`,
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.details) && data.details.length
      ? `: ${data.details.join("; ")}`
      : "";
    throw new Error(`${data.error || `Request failed (${response.status})`}${detail}`);
  }
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
    const previousUserId = session?.user?.id ?? null;
    const nextUserId = newSession?.user?.id ?? null;
    session = newSession;
    if (newSession?.provider_token) {
      sessionStorage.setItem("discord_provider_token", newSession.provider_token);
    }
    if (previousUserId !== nextUserId) {
      state = { orgId: null };
      render();
    }
  });

  render();
}

function renderAccount() {
  accountEl.innerHTML = "";
  if (!session) {
    // Persistent entry point so returning admins can always reach their dashboard.
    const login = el(`<button class="btn-primary btn-nav">Log in</button>`);
    login.onclick = signInWithDiscord;
    accountEl.append(login);
    return;
  }
  if (state.orgId) {
    const back = el(`<button class="btn-ghost btn-nav">My servers</button>`);
    back.onclick = () => {
      state = { orgId: null };
      render();
    };
    accountEl.append(back);
  }
  const signOut = el(`<button class="btn-ghost btn-nav">Sign out</button>`);
  signOut.onclick = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem("discord_provider_token");
    state = { orgId: null };
  };
  accountEl.append(signOut);
}

function render() {
  renderAccount();
  if (!session) {
    document.body.classList.add("landing-mode");
    return renderLogin();
  }
  document.body.classList.remove("landing-mode");
  if (!state.orgId) return renderServers();
  return renderOrg();
}

function signInWithDiscord() {
  supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { scopes: "identify guilds", redirectTo: window.location.origin },
  });
}

const discordGlyph = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5a14.6 14.6 0 0 1 4.3 1.36 13.4 13.4 0 0 0-11-.02A14.4 14.4 0 0 1 12.8 3.5L12.55 3A19.8 19.8 0 0 0 7.7 4.4C4.6 9 3.76 13.5 4.18 17.94a19.9 19.9 0 0 0 6.06 3.06l.77-1.06a12.9 12.9 0 0 1-2.05-.98l.5-.37a14.2 14.2 0 0 0 12.08 0l.5.37c-.65.39-1.34.72-2.05.98l.77 1.06a19.9 19.9 0 0 0 6.06-3.06c.5-5.14-.85-9.6-3.5-13.54ZM9.55 15.3c-1.18 0-2.15-1.09-2.15-2.43 0-1.34.95-2.43 2.15-2.43 1.2 0 2.17 1.1 2.15 2.43 0 1.34-.95 2.43-2.15 2.43Zm4.9 0c-1.18 0-2.15-1.09-2.15-2.43 0-1.34.95-2.43 2.15-2.43 1.2 0 2.17 1.1 2.15 2.43 0 1.34-.94 2.43-2.15 2.43Z"/></svg>`;

function renderLogin() {
  app.innerHTML = "";

  const hero = el(`
    <section class="lp-hero">
      <div>
        <img src="/relay-logo-full.png" alt="Relay — Collaborative AI for Discord" class="lp-logo" />
        <h1 class="lp-title">Bring AI agents to your server with <span class="accent">one command</span></h1>
        <p class="lp-sub">
          Relay drops collaborative AI into Discord. Members type
          <code>/agent</code> to run a Cursor cloud agent on your GitHub repo — or
          chat with ChatGPT, Gemini, and Claude — right where your team already talks.
        </p>
        <div class="lp-cta">
          <button class="btn-discord btn-lg" id="lp-signin">${discordGlyph} Integrate now — sign in with Discord</button>
          <a href="/guide.html"><button class="btn-ghost btn-lg">See how it works</button></a>
        </div>
        <p class="lp-note">Free to add · Setup takes ~5 minutes · Bring your own AI keys</p>
      </div>
      <div>
        <div class="chat-mock">
          <div class="cm-row">
            <div class="cm-avatar user">A</div>
            <div class="cm-body">
              <div class="cm-name">alex<span class="cm-time">Today at 2:31 PM</span></div>
              <div class="cm-cmd"><span class="cm-slash">/agent</span> prompt: add a dark mode toggle to settings</div>
            </div>
          </div>
          <div class="cm-row">
            <div class="cm-avatar bot">◆</div>
            <div class="cm-body">
              <div class="cm-name">Relay<span class="cm-badge">APP</span><span class="cm-time">Today at 2:34 PM</span></div>
              <div class="cm-embed">
                <div class="cm-embed-title">Finished · Website</div>
                <div class="cm-embed-field">Branch: <span class="link">cursor/dark-mode-toggle</span></div>
                <div class="cm-embed-field">Pull request: <span class="link">#128 Add dark mode toggle</span></div>
                <div class="cm-embed-meta">Cursor Cloud Agents · main</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `);

  const highlights = el(`
    <section class="lp-highlights">
      <span class="lp-chip"><span class="dot"></span> Runs in the cloud — nothing to host</span>
      <span class="lp-chip"><span class="dot"></span> Opens a PR on every task</span>
      <span class="lp-chip"><span class="dot"></span> Bring your own Cursor key</span>
      <span class="lp-chip"><span class="dot"></span> ~5-minute setup</span>
    </section>
  `);

  const features = el(`
    <section class="lp-section reveal" id="features">
      <div class="lp-section-head">
        <h2>Why add it to your server</h2>
        <p>Turn conversations into shipped code. Perfect for open-source projects, dev teams, and study groups.</p>
      </div>
      <div class="feature-grid">
        <div class="feature">
          <div class="ic">⚡</div>
          <h3>Code without leaving Discord</h3>
          <p>Kick off real coding tasks from any channel. The agent runs in the cloud and reports back with results and PRs.</p>
        </div>
        <div class="feature">
          <div class="ic">🔀</div>
          <h3>Automatic pull requests</h3>
          <p>Every task can open a GitHub PR on its own branch, so nothing lands without review. Follow-ups continue the same agent.</p>
        </div>
        <div class="feature">
          <div class="ic">🔒</div>
          <h3>Roles &amp; channels you control</h3>
          <p>Map repos to channels and pick exactly which roles can use the bot. Your Cursor key is encrypted and never shared.</p>
        </div>
        <div class="feature">
          <div class="ic">📁</div>
          <h3>Multiple repos</h3>
          <p>Wire up as many repositories as you want — one per channel, or switch between them with a simple option.</p>
        </div>
        <div class="feature">
          <div class="ic">👀</div>
          <h3>Live status updates</h3>
          <p>Watch each run go from Started to Running to Finished in real time, with a link straight to the agent.</p>
        </div>
        <div class="feature">
          <div class="ic">🛑</div>
          <h3>Full control</h3>
          <p>Cancel a running agent anytime with <code>/agent-cancel</code>, check history with <code>/agent-status</code>.</p>
        </div>
      </div>
    </section>
  `);

  const how = el(`
    <section class="lp-section reveal" id="how">
      <div class="lp-section-head">
        <h2>Live in three steps</h2>
        <p>No servers to run, no code to deploy. Sign in and configure from this dashboard.</p>
      </div>
      <div class="how-grid">
        <div class="how-step">
          <div class="num">1</div>
          <h3>Add the bot</h3>
          <p>Sign in with Discord and invite the bot to a server where you have Manage Server.</p>
        </div>
        <div class="how-step">
          <div class="num">2</div>
          <h3>Connect a repo</h3>
          <p>Add your Cursor API key, link a GitHub repo, and choose the roles and channels allowed to use it.</p>
        </div>
        <div class="how-step">
          <div class="num">3</div>
          <h3>Type <code>/agent</code></h3>
          <p>Your team starts shipping. The agent works in the cloud and posts results back to the channel.</p>
        </div>
      </div>
    </section>
  `);

  const commands = el(`
    <section class="lp-section reveal">
      <div class="lp-section-head">
        <h2>Simple slash commands</h2>
        <p>Everything your members need, right in the message box.</p>
      </div>
      <div class="cmd-grid">
        <div class="cmd-row"><code>/agent</code><span>Start or continue this channel's agent</span></div>
        <div class="cmd-row"><code>/agent-new</code><span>Always start a fresh agent</span></div>
        <div class="cmd-row"><code>/agent-cancel</code><span>Stop the running agent and unlock the channel</span></div>
        <div class="cmd-row"><code>/agent-status</code><span>See recent agents and runs here</span></div>
        <div class="cmd-row"><code>/agent-projects</code><span>List the repos you can access</span></div>
        <div class="cmd-row"><code>/cursor…</code><span>Aliases for all of the above</span></div>
      </div>
    </section>
  `);

  const faq = el(`
    <section class="lp-section reveal" id="faq">
      <div class="lp-section-head">
        <h2>Frequently asked questions</h2>
        <p>Everything you need to know before adding the bot.</p>
      </div>
      <div class="faq">
        <details class="faq-item">
          <summary>Is it free?</summary>
          <div class="faq-body">The bot itself is free to add and use. Cloud agents run on your own Cursor account, so you only pay Cursor for the agent usage with your own API key.</div>
        </details>
        <details class="faq-item">
          <summary>Do I need to host or deploy anything?</summary>
          <div class="faq-body">No. The bot is fully hosted. You just sign in with Discord, invite it to your server, and configure everything from this dashboard.</div>
        </details>
        <details class="faq-item">
          <summary>Is my Cursor API key safe?</summary>
          <div class="faq-body">Yes. Your key is encrypted before it's stored and is never displayed again or shared with members. Only the bot's backend can use it to launch agents on your behalf.</div>
        </details>
        <details class="faq-item">
          <summary>Who can use the bot in my server?</summary>
          <div class="faq-body">You decide. Each project is mapped to specific roles and channels, so only the members you allow can start agents — and only in the channels you choose.</div>
        </details>
        <details class="faq-item">
          <summary>Can I connect more than one repository?</summary>
          <div class="faq-body">Absolutely. Add as many repos as you like — map each to its own channel, or let members switch between them with a <code>project</code> option on the command.</div>
        </details>
        <details class="faq-item">
          <summary>What does it do with my code?</summary>
          <div class="faq-body">A Cursor cloud agent clones your GitHub repo, makes changes on a new branch, and can open a pull request so nothing lands without review. See the <a href="/guide.html">setup guide</a> for details.</div>
        </details>
        <details class="faq-item">
          <summary>What if an agent gets stuck?</summary>
          <div class="faq-body">Run <code>/agent-cancel</code> in the channel to stop the current agent and unlock it, then start a new prompt right away.</div>
        </details>
      </div>
    </section>
  `);

  const cta = el(`
    <section class="cta-band reveal">
      <h2>Ready to integrate?</h2>
      <p>Add the AI bot to your server in minutes.</p>
      <button class="btn-discord btn-lg" id="lp-signin-2">${discordGlyph} Integrate now — sign in with Discord</button>
    </section>
  `);

  const footer = el(`
    <footer class="lp-footer">
      <div class="lp-footer-about">
        <img src="/relay-wordmark.png" alt="Relay" class="brand-logo" />
        <p>Collaborative AI for Discord. Ship code, open pull requests, and chat with top AI models — all without leaving your server.</p>
      </div>
      <div>
        <h4>Product</h4>
        <a href="#features">Features</a>
        <a href="#how">How it works</a>
        <a href="#faq">FAQ</a>
      </div>
      <div>
        <h4>Resources</h4>
        <a href="/guide.html">Setup guide</a>
        <a href="https://github.com/D-AZ0617/Discord-AI-Bot" target="_blank" rel="noopener">GitHub</a>
        <a href="https://cursor.com" target="_blank" rel="noopener">Cursor</a>
      </div>
    </footer>
  `);

  const footerBottom = el(`
    <div class="lp-footer-bottom">Relay · Collaborative AI for Discord · Not affiliated with Discord Inc.</div>
  `);

  app.append(hero, highlights, features, how, commands, faq, cta, footer, footerBottom);
  hero.querySelector("#lp-signin").onclick = signInWithDiscord;
  cta.querySelector("#lp-signin-2").onclick = signInWithDiscord;
  setupReveal();
}

function setupReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  items.forEach((el) => observer.observe(el));
}

async function renderServers() {
  app.innerHTML = "";
  const listCard = el(`
    <section class="card">
      <h2>Choose a server</h2>
      <p class="hint">Add Relay to a server you manage, or continue configuring one where it is already installed.</p>
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

    const finishInstallation = async (guild, button) => {
      const install = async () =>
        api("/api/install", {
          method: "POST",
          body: JSON.stringify({
            guildId: guild.id,
            guildName: guild.name,
            providerToken: token,
          }),
        });

      button.disabled = true;
      try {
        // If Relay is already present but has not been registered in the
        // dashboard yet, skip sending the admin through Discord again.
        const { orgId } = await install();
        state = { orgId, guildId: guild.id, guildName: guild.name };
        render();
        return;
      } catch {
        // A new server needs the Discord authorization step first.
      }

      const installUrl = new URL(config.installUrl);
      installUrl.searchParams.set("guild_id", guild.id);
      installUrl.searchParams.set("disable_guild_select", "true");
      const popup = window.open(installUrl.toString(), "_blank");
      if (!popup) {
        button.disabled = false;
        toast("Allow pop-ups to add Relay to Discord.", true);
        return;
      }
      popup.opener = null;

      button.textContent = "Waiting for Discord…";
      let lastError = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const { orgId } = await install();
          state = { orgId, guildId: guild.id, guildName: guild.name };
          render();
          return;
        } catch (error) {
          lastError = error;
        }
        if (popup.closed && attempt >= 2) break;
      }
      button.disabled = false;
      button.textContent = "Add to Discord";
      toast(
        lastError?.message ||
          "Relay was not added. Complete the Discord authorization and try again.",
        true,
      );
    };

    for (const guild of guilds) {
      const item = el(`
        <div class="item">
          <div><strong>${escapeHtml(guild.name)}</strong>
          <div class="meta">${guild.id}</div></div>
        </div>
      `);
      const action = el(
        `<button class="btn-primary">${guild.orgId ? "Configure" : "Add to Discord"}</button>`,
      );
      action.onclick = () => {
        if (guild.orgId) {
          state = {
            orgId: guild.orgId,
            guildId: guild.id,
            guildName: guild.name,
          };
          render();
          return;
        }
        finishInstallation(guild, action);
      };
      item.append(action);
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

  const serverName = state.guildName ? escapeHtml(state.guildName) : "your server";
  const hints = el(`
    <section class="card hint-card">
      <h2>Configuring ${serverName}</h2>
      <ol class="steps">
        <li><strong>Add a provider key</strong> — bring your own key for Cursor, OpenAI, Gemini, Claude, or OpenRouter. Use <em>Test connection</em> to confirm it works.</li>
        <li><strong>Create a project</strong> — connect a repo (Cursor) or pick a chat model, then choose which channels and roles can use it.</li>
        <li><strong>Try it in Discord</strong> — a permitted member types <code>/agent prompt: …</code> in a mapped channel.</li>
      </ol>
      <p class="hint">Tips: leave channels unchecked to allow the whole server · one active run per channel — use <code>/agent-cancel</code> to stop one · full walkthrough in the <a href="/guide.html">setup guide</a>.</p>
    </section>
  `);
  app.append(hints);

  await renderCredentials();
  await renderProjects();
}

function providerList() {
  return (config && config.providers) || [];
}
function providerById(id) {
  return providerList().find((p) => p.id === id);
}
function displayNameFor(id) {
  return providerById(id)?.displayName || id;
}

async function renderCredentials() {
  const providers = providerList();
  const options = providers
    .map((p) => `<option value="${p.id}">${escapeHtml(p.displayName)}</option>`)
    .join("");

  const card = el(`
    <section class="card">
      <h2>AI provider keys</h2>
      <p class="hint">Add a key for each AI you want to use. Keys are encrypted before storage and never shown again.</p>
      <div id="cred-status" class="list"></div>
      <div class="divider"></div>
      <label>Provider</label>
      <select id="cred-provider">${options}</select>
      <p class="hint" id="cred-hint"></p>
      <label>API key</label>
      <input id="cred-key" type="password" placeholder="Paste your API key" autocomplete="off" />
      <div class="actions">
        <button class="btn-primary" id="cred-save">Save key</button>
        <button class="btn-ghost" id="cred-test">Test connection</button>
      </div>
    </section>
  `);
  app.append(card);

  const providerSel = card.querySelector("#cred-provider");
  const hintEl = card.querySelector("#cred-hint");
  const updateHint = () => {
    const p = providerById(providerSel.value);
    hintEl.innerHTML = p?.apiKeyHint
      ? `Get your key from <strong>${escapeHtml(p.apiKeyHint)}</strong>.`
      : "";
  };
  providerSel.onchange = updateHint;
  updateHint();

  const refresh = async () => {
    const statusEl = card.querySelector("#cred-status");
    try {
      const { providers: configured } = await api(`/api/credentials?orgId=${state.orgId}`);
      statusEl.innerHTML = configured.length
        ? configured
            .map(
              (p) =>
                `<div class="item">
                  <span>${escapeHtml(displayNameFor(p))} <span class="pill ok">configured</span></span>
                  <button class="btn-danger cred-delete" data-provider="${escapeHtml(p)}">Remove key</button>
                </div>`,
            )
            .join("")
        : `<p class="muted">No provider keys yet. Add one below to get started.</p>`;
      statusEl.querySelectorAll(".cred-delete").forEach((button) => {
        button.onclick = async () => {
          const providerId = button.dataset.provider;
          const providerName = displayNameFor(providerId);
          if (
            !confirm(
              `Remove the ${providerName} API key? Projects using it will stop working until another key is added.`,
            )
          ) {
            return;
          }
          button.disabled = true;
          try {
            await api(
              `/api/credentials?orgId=${state.orgId}&providerId=${encodeURIComponent(providerId)}`,
              { method: "DELETE" },
            );
            toast(`${providerName} key removed`);
            refresh();
          } catch (error) {
            button.disabled = false;
            toast(error.message, true);
          }
        };
      });
    } catch (error) {
      statusEl.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  };

  card.querySelector("#cred-save").onclick = async () => {
    const providerId = providerSel.value;
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
    const providerId = providerSel.value;
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
  // Load the server's real roles/channels so admins pick from dropdowns instead
  // of pasting IDs. Falls back to manual ID entry if the lookup fails.
  let meta = null;
  let metaWarnings = [];
  try {
    meta = await api(`/api/guild-meta?orgId=${state.orgId}&guildId=${state.guildId}`);
    metaWarnings = meta.warnings || [];
  } catch (error) {
    metaWarnings = [error.message];
    meta = null;
  }

  const channelControl = meta
    ? `<div class="picker" id="p-channels">${
        meta.channels.length
          ? meta.channels
              .map(
                (c) =>
                  `<label><input type="checkbox" value="${c.id}" /> #${escapeHtml(c.name)}</label>`,
              )
              .join("")
          : `<p class="muted" style="margin:0">No text channels found.</p>`
      }</div>
       <p class="hint">Leave all unchecked to allow the <strong>whole server</strong>.</p>`
    : `<input id="p-channels" placeholder="Leave blank for the whole server" />
       <p class="hint">Comma-separated <em>channel</em> IDs. Leave blank for the whole server — do not paste your server ID.</p>`;

  const roleControl = meta
    ? `<div class="picker" id="p-roles">${
        meta.roles.length
          ? meta.roles
              .map(
                (r) =>
                  `<label><input type="checkbox" value="${r.id}" /> @${escapeHtml(r.name)}${
                    r.managed ? ` <span class="tag">bot/managed</span>` : ""
                  }</label>`,
              )
              .join("")
          : `<p class="muted" style="margin:0">No roles found. Create a role in Discord first.</p>`
      }</div>
       <p class="hint">Check at least one role allowed to use the bot.</p>`
    : `<input id="p-roles" placeholder="123456789012345678" />
       <p class="hint">Comma-separated <em>role</em> IDs (at least one). @everyone does not work.</p>`;

  const providers = providerList();
  const providerOptions = providers
    .map((p) => `<option value="${p.id}">${escapeHtml(p.displayName)}</option>`)
    .join("");

  const card = el(`
    <section class="card">
      <h2>Projects</h2>
      <p class="hint">Connect a repo (for Cursor cloud agents) or a chat model to a channel and roles. Add as many as you like.</p>
      ${
        metaWarnings.length
          ? `<div class="callout warn">${metaWarnings.map(escapeHtml).join("<br>")}</div>`
          : ""
      }
      <div id="project-list" class="list"></div>
      <div class="divider"></div>
      <h3 id="p-form-title" style="margin:0 0 4px">Add a project</h3>
      <label>Project name</label>
      <input id="p-display" placeholder="Website Assistant" />
      <p class="hint">This is the name people will see in Discord.</p>
      <label>Provider</label>
      <select id="p-provider">${providerOptions}</select>

      <div id="p-repo-fields">
        <label>GitHub repo URL</label>
        <input id="p-repo" placeholder="https://github.com/owner/repo" />
        <div class="row">
          <div><label>Default branch (optional)</label><input id="p-branch" placeholder="main" /></div>
        </div>
        <label><input type="checkbox" id="p-pr" checked style="width:auto;margin-right:8px" />Auto-create pull requests</label>
      </div>

      <div id="p-chat-fields" hidden>
        <label>Suggested model</label>
        <select id="p-model-picker"></select>
        <label>Model ID</label>
        <input id="p-model" placeholder="model name" />
        <p class="hint" id="p-model-hint">Choose a suggestion above or type any model ID the provider supports.</p>
      </div>

      <label>Channels</label>
      ${channelControl}
      <label>Allowed roles</label>
      ${roleControl}
      <div class="actions">
        <button class="btn-primary" id="p-save">Add project</button>
        <button class="btn-ghost" id="p-cancel" hidden>Cancel edit</button>
      </div>
    </section>
  `);
  app.append(card);

  const listEl = card.querySelector("#project-list");
  const saveBtn = card.querySelector("#p-save");
  const cancelBtn = card.querySelector("#p-cancel");
  const titleEl = card.querySelector("#p-form-title");
  const providerSel = card.querySelector("#p-provider");
  const displayNameEl = card.querySelector("#p-display");
  const repoFields = card.querySelector("#p-repo-fields");
  const chatFields = card.querySelector("#p-chat-fields");
  const modelEl = card.querySelector("#p-model");
  const modelPickerEl = card.querySelector("#p-model-picker");
  let projectsCache = [];
  let editingName = null;
  let projectNameCustomized = false;

  const currentKind = () => providerById(providerSel.value)?.kind || "repo";
  const useProviderAsProjectName = () => {
    displayNameEl.value = uniqueProjectDisplayName(
      displayNameFor(providerSel.value),
      projectsCache,
    );
  };

  const applyProviderKind = (keepModel = false) => {
    const p = providerById(providerSel.value);
    const isChat = p?.kind === "chat";
    repoFields.hidden = isChat;
    chatFields.hidden = !isChat;
    if (isChat) {
      const models = p?.suggestedModels || [];
      if (!keepModel) {
        modelEl.value = models[0] || "";
      }
      const isSuggested = models.includes(modelEl.value);
      modelPickerEl.innerHTML = `${
        isSuggested ? "" : `<option value="">Custom model ID</option>`
      }${models
        .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
        .join("")}`;
      modelPickerEl.value = isSuggested ? modelEl.value : "";
    }
  };
  modelPickerEl.onchange = () => {
    modelEl.value = modelPickerEl.value;
  };
  displayNameEl.oninput = () => {
    projectNameCustomized = true;
  };
  providerSel.onchange = () => {
    applyProviderKind(false);
    if (!editingName && !projectNameCustomized) useProviderAsProjectName();
  };

  const getIds = (id) => {
    const control = card.querySelector(`#${id}`);
    if (control.classList?.contains("picker")) {
      return Array.from(control.querySelectorAll("input:checked")).map((i) => i.value);
    }
    return control.value.split(",").map((s) => s.trim()).filter(Boolean);
  };
  const setIds = (id, ids) => {
    const control = card.querySelector(`#${id}`);
    const wanted = new Set(ids);
    if (control.classList?.contains("picker")) {
      control.querySelectorAll("input").forEach((i) => {
        i.checked = wanted.has(i.value);
      });
    } else {
      control.value = ids.join(", ");
    }
  };

  const resetForm = () => {
    editingName = null;
    projectNameCustomized = false;
    card.querySelector("#p-repo").value = "";
    card.querySelector("#p-branch").value = "";
    providerSel.value = providers[0]?.id || "cursor";
    useProviderAsProjectName();
    card.querySelector("#p-pr").checked = true;
    modelEl.value = "";
    applyProviderKind(false);
    setIds("p-channels", []);
    setIds("p-roles", []);
    titleEl.textContent = "Add a project";
    saveBtn.textContent = "Add project";
    cancelBtn.hidden = true;
  };

  const loadForEdit = (project) => {
    editingName = project.name;
    projectNameCustomized = true;
    displayNameEl.value = project.displayName || project.name;
    card.querySelector("#p-repo").value = project.repoUrl || "";
    card.querySelector("#p-branch").value = project.defaultBranch || "";
    providerSel.value = project.provider || "cursor";
    card.querySelector("#p-pr").checked = project.autoCreatePR;
    modelEl.value = (project.providerOptions && project.providerOptions.model) || "";
    applyProviderKind(true);
    setIds("p-channels", project.channelIds);
    setIds("p-roles", project.allowedRoleIds);
    titleEl.textContent = `Edit “${project.displayName || project.name}”`;
    saveBtn.textContent = "Update project";
    cancelBtn.hidden = false;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  cancelBtn.onclick = resetForm;

  const refresh = async () => {
    try {
      const { projects } = await api(`/api/projects?orgId=${state.orgId}`);
      projectsCache = projects;
      if (!editingName && !projectNameCustomized) useProviderAsProjectName();
      listEl.innerHTML = "";
      if (projects.length === 0) {
        listEl.innerHTML = `<p class="muted">No projects yet.</p>`;
        return;
      }
      for (const project of projects) {
        const scope = project.channelIds.length ? `${project.channelIds.length} channel(s)` : "whole server";
        const target =
          project.repoUrl ||
          (project.providerOptions && project.providerOptions.model) ||
          "";
        const item = el(`
          <div class="item">
            <div>
              <strong>${escapeHtml(project.displayName || project.name)}</strong>
              <span class="pill">${escapeHtml(displayNameFor(project.provider))}</span>
              <div class="meta">${escapeHtml(target)}${target ? " · " : ""}${scope}</div>
            </div>
          </div>
        `);
        const actions = el(`<div class="item-actions"></div>`);
        const edit = el(`<button class="btn-ghost">Edit</button>`);
        edit.onclick = () => loadForEdit(project);
        const del = el(`<button class="btn-danger">Remove</button>`);
        del.onclick = async () => {
          if (!confirm(`Remove project “${project.displayName || project.name}”?`)) return;
          try {
            await api(`/api/projects?orgId=${state.orgId}&name=${encodeURIComponent(project.name)}`, {
              method: "DELETE",
            });
            if (editingName === project.name) resetForm();
            refresh();
          } catch (error) {
            toast(error.message, true);
          }
        };
        actions.append(edit, del);
        item.append(actions);
        listEl.append(item);
      }
    } catch (error) {
      listEl.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  };

  saveBtn.onclick = async () => {
    const enteredDisplayName = displayNameEl.value.trim();
    if (!enteredDisplayName) {
      toast("Enter a project name.", true);
      return;
    }
    const displayName = editingName
      ? enteredDisplayName
      : uniqueProjectDisplayName(enteredDisplayName, projectsCache);
    const name =
      editingName ||
      projectSlug(displayName, new Set(projectsCache.map((project) => project.name)));
    const isChat = currentKind() === "chat";
    const project = {
      name,
      displayName,
      guildId: state.guildId,
      provider: providerSel.value || "cursor",
      channelIds: getIds("p-channels"),
      allowedRoleIds: getIds("p-roles"),
      repoUrl: isChat ? "" : card.querySelector("#p-repo").value.trim(),
      defaultBranch: isChat
        ? undefined
        : card.querySelector("#p-branch").value.trim() || undefined,
      autoCreatePR: isChat ? false : card.querySelector("#p-pr").checked,
      providerOptions: isChat ? { model: modelEl.value.trim() } : {},
    };

    saveBtn.disabled = true;
    try {
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({ orgId: state.orgId, project }),
      });
      toast(editingName ? "Project updated" : "Project added");
      resetForm();
      refresh();
    } catch (error) {
      toast(error.message, true);
    } finally {
      saveBtn.disabled = false;
    }
  };

  useProviderAsProjectName();
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
