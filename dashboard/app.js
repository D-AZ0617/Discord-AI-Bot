import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const app = document.getElementById("app");
const accountEl = document.getElementById("account");
const toastEl = document.getElementById("toast");

let supabase = null;
let config = null;
let session = null;
let state = { orgId: null };
// Tracks which wizard step the current org view is on, so navigation within a
// server persists across re-renders but resets when switching servers.
let orgView = {
  orgId: null,
  view: "overview",
  step: 1,
  editProjectName: null,
  openForm: false,
};
// Cached list of manageable servers so navigating back to the list doesn't
// refetch every time. Invalidated on install, user change, or manual refresh.
let guildsCache = null;
// Provider chosen on the "Connect AI" step, used to pre-select the matching
// fields when the admin moves on to create their first project.
let pendingProjectProvider = null;

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
      guildsCache = null;
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
    guildsCache = null;
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
        <h1 class="lp-title">Bring AI to your server with <span class="accent">one command</span></h1>
        <p class="lp-sub">
          Relay brings AI into Discord. Members type <code>/agent</code> to chat
          with ChatGPT, Gemini, Claude, or free OpenRouter models — or hand a
          coding task to a Cursor cloud agent that opens a pull request. Whatever
          your team needs AI for, it happens right where you already talk.
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
            <div class="cm-avatar user">J</div>
            <div class="cm-body">
              <div class="cm-name">jamie<span class="cm-time">Today at 2:14 PM</span></div>
              <div class="cm-cmd"><span class="cm-slash">/agent</span> prompt: explain the difference between REST and GraphQL</div>
            </div>
          </div>
          <div class="cm-row">
            <div class="cm-avatar bot">◆</div>
            <div class="cm-body">
              <div class="cm-name">Relay<span class="cm-badge">APP</span><span class="cm-time">Today at 2:14 PM</span></div>
              <div class="cm-embed">
                <div class="cm-embed-title">Answer · Ask Anything</div>
                <div class="cm-embed-field">REST exposes fixed endpoints that each return a set shape of data, while GraphQL uses one endpoint where the client asks for exactly the fields it needs…</div>
                <div class="cm-embed-meta">OpenRouter · openrouter/free</div>
              </div>
            </div>
          </div>
          <div class="cm-row">
            <div class="cm-avatar user">A</div>
            <div class="cm-body">
              <div class="cm-name">alex<span class="cm-time">Today at 2:31 PM</span></div>
              <div class="cm-cmd"><span class="cm-slash">/agent</span> prompt: add a dark mode toggle to settings project: website</div>
            </div>
          </div>
          <div class="cm-row">
            <div class="cm-avatar bot">◆</div>
            <div class="cm-body">
              <div class="cm-name">Relay<span class="cm-badge">APP</span><span class="cm-time">Today at 2:34 PM</span></div>
              <div class="cm-embed">
                <div class="cm-embed-title">Finished · Website</div>
                <div class="cm-embed-field">Branch: <span class="link">feature/dark-mode-toggle</span></div>
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
      <span class="lp-chip"><span class="dot"></span> Chat with top models or run coding agents</span>
      <span class="lp-chip"><span class="dot"></span> Works with ChatGPT, Gemini, Claude &amp; OpenRouter</span>
      <span class="lp-chip"><span class="dot"></span> Bring your own AI keys · ~5-minute setup</span>
    </section>
  `);

  const features = el(`
    <section class="lp-section reveal" id="features">
      <div class="lp-section-head">
        <h2>Why add it to your server</h2>
        <p>Whatever your team uses AI for — answering questions, brainstorming, or shipping code — Relay brings it into Discord. Great for communities, dev teams, study groups, and support servers.</p>
      </div>
      <div class="feature-grid">
        <div class="feature">
          <div class="ic">💬</div>
          <h3>Chat with top AI models</h3>
          <p>Ask questions and get answers from ChatGPT, Gemini, Claude, or free OpenRouter models — right in the channel, no repo or member setup required.</p>
        </div>
        <div class="feature">
          <div class="ic">⚡</div>
          <h3>Code without leaving Discord</h3>
          <p>Hand a coding task to a Cursor cloud agent. It runs in the cloud, works on your repo, and reports back with results.</p>
        </div>
        <div class="feature">
          <div class="ic">🔀</div>
          <h3>Automatic pull requests</h3>
          <p>For coding projects, every task can open a GitHub PR on its own branch, so nothing lands without review.</p>
        </div>
        <div class="feature">
          <div class="ic">🔒</div>
          <h3>Roles &amp; channels you control</h3>
          <p>Pick exactly which roles can use each project and where. Your API keys are encrypted and never shared.</p>
        </div>
        <div class="feature">
          <div class="ic">🧩</div>
          <h3>One bot, many providers</h3>
          <p>Run several projects side by side — a chat model in one channel, a coding agent in another, and switch with a simple option.</p>
        </div>
        <div class="feature">
          <div class="ic">👀</div>
          <h3>Live status updates</h3>
          <p>Watch each run go from Started to Finished in real time, with a link straight to the result.</p>
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
          <h3>Connect an AI</h3>
          <p>Add a key for the AI you want — a chat model like ChatGPT, Gemini, Claude, or OpenRouter, or Cursor for coding agents — then pick the roles and channels allowed to use it.</p>
        </div>
        <div class="how-step">
          <div class="num">3</div>
          <h3>Type <code>/agent</code></h3>
          <p>Your team starts asking and building. Relay works in the cloud and posts answers or results back to the channel.</p>
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
        <div class="cmd-row"><code>/agent-cursor</code><span>Run one prompt with a specific AI (also -openrouter, -chatgpt, -claude, -gemini)</span></div>
        <div class="cmd-row"><code>/agent-cancel</code><span>Stop the running agent and unlock the channel</span></div>
        <div class="cmd-row"><code>/agent-status</code><span>See recent runs here</span></div>
        <div class="cmd-row"><code>/agent-projects</code><span>List the projects you can access</span></div>
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
          <summary>What can I use it for?</summary>
          <div class="faq-body">Two things, and you can do either or both. <strong>Chat:</strong> ask questions and get answers from ChatGPT, Gemini, Claude, or OpenRouter — great for Q&amp;A, brainstorming, and support. <strong>Code:</strong> hand a task to a Cursor cloud agent that works on your GitHub repo and can open a pull request.</div>
        </details>
        <details class="faq-item">
          <summary>Is it free?</summary>
          <div class="faq-body">The bot is free to add and use. AI runs on your own provider accounts, so you bring your own keys and only pay the provider for what you use. OpenRouter even offers free models to get started at no cost.</div>
        </details>
        <details class="faq-item">
          <summary>Do I need to host or deploy anything?</summary>
          <div class="faq-body">No. The bot is fully hosted. You just sign in with Discord, invite it to your server, and configure everything from this dashboard.</div>
        </details>
        <details class="faq-item">
          <summary>Which AI providers are supported?</summary>
          <div class="faq-body">For chat: OpenAI (ChatGPT), Google Gemini, Anthropic (Claude), and OpenRouter (including free models). For coding tasks that work on a repo and open PRs: Cursor cloud agents. Add whichever you like — no need to use all of them.</div>
        </details>
        <details class="faq-item">
          <summary>Are my API keys safe?</summary>
          <div class="faq-body">Yes. Each key is encrypted before it's stored and is never displayed again or shared with members. Only the bot's backend can use it on your behalf.</div>
        </details>
        <details class="faq-item">
          <summary>Who can use the bot in my server?</summary>
          <div class="faq-body">You decide. Each project is mapped to specific roles and channels, so only the members you allow can use it — and only in the channels you choose.</div>
        </details>
        <details class="faq-item">
          <summary>Can I set up more than one AI or project?</summary>
          <div class="faq-body">Absolutely. Add as many projects as you like — run a chat model in one channel and a coding agent in another, connect multiple repos, or let members switch with a <code>project</code> option on the command.</div>
        </details>
        <details class="faq-item">
          <summary>Does it access my code?</summary>
          <div class="faq-body">Only coding projects touch code. A Cursor cloud agent clones your GitHub repo, works on a new branch, and can open a pull request so nothing lands without review. Chat projects never access any repo. See the <a href="/guide.html">setup guide</a> for details.</div>
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
      <p>Add Relay to your server in minutes — chat or code, your call.</p>
      <button class="btn-discord btn-lg" id="lp-signin-2">${discordGlyph} Integrate now — sign in with Discord</button>
    </section>
  `);

  const footer = el(`
    <footer class="lp-footer">
      <div class="lp-footer-about">
        <img src="/relay-wordmark.png" alt="Relay" class="brand-logo" />
        <p>Collaborative AI for Discord. Chat with top AI models or run coding agents that open pull requests — all without leaving your server.</p>
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
      </div>
      <div>
        <h4>Legal</h4>
        <a href="/terms.html">Terms of Service</a>
        <a href="/privacy.html">Privacy Policy</a>
      </div>
    </footer>
  `);

  const footerBottom = el(`
    <div class="lp-footer-bottom">Relay · Collaborative AI for Discord · <a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · Not affiliated with Discord Inc.</div>
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

/**
 * Discord CDN URL for a guild icon, or null when the server has no icon.
 * The `size` query must be a power of two (Discord rejects other values), so we
 * always request a fixed 128px and let CSS scale it down for display.
 */
function guildIconUrl(guild) {
  if (!guild || !guild.icon) return null;
  const ext = String(guild.icon).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=128`;
}

/** Two-letter initials for the icon fallback badge. */
function serverInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Rounded avatar for a server. Initials always render underneath; when the
 * server has an icon we overlay the real image, which removes itself on error
 * so the initials remain a graceful fallback.
 */
function serverAvatar(guild, size = 48) {
  const url = guildIconUrl(guild);
  const initials = escapeHtml(serverInitials(guild && guild.name));
  const image = url
    ? `<img class="srv-img" src="${url}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  return `<span class="srv-avatar srv-avatar-fallback" style="width:${size}px;height:${size}px"><span class="srv-initials">${initials}</span>${image}</span>`;
}

async function renderServers(forceReload = false) {
  app.innerHTML = "";
  const listCard = el(`
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Your servers</h2>
          <p class="hint">Add Relay to a server you manage, or continue configuring one where it's already installed.</p>
        </div>
        <button class="btn-ghost btn-refresh" id="refresh-guilds" title="Reload your server list from Discord">↻ Refresh</button>
      </div>
      <div class="server-grid" id="guilds"></div>
    </section>
  `);
  app.append(listCard);
  app.append(renderHelpCard());

  const guildsEl = listCard.querySelector("#guilds");
  const refreshBtn = listCard.querySelector("#refresh-guilds");
  refreshBtn.onclick = () => {
    guildsCache = null;
    renderServers(true);
  };

  const token = providerToken();
  if (!token) {
    guildsEl.innerHTML = `<p class="muted">Re-sign in to grant server access.</p>`;
    return;
  }

  let guilds = guildsCache;
  if (!guilds || forceReload) {
    guildsEl.innerHTML = `<p class="muted">Loading servers…</p>`;
    refreshBtn.disabled = true;
    try {
      const res = await api("/api/guilds", {
        headers: { "x-discord-provider-token": token },
      });
      guilds = res.guilds;
      guildsCache = guilds;
    } catch (error) {
      guildsEl.innerHTML = `<p class="muted">${escapeHtml(error?.message || String(error))}</p>`;
      refreshBtn.disabled = false;
      return;
    }
    refreshBtn.disabled = false;
  }

  {
    guildsEl.innerHTML = "";
    if (guilds.length === 0) {
      guildsEl.innerHTML = `<p class="muted">No manageable servers found.</p>`;
      return;
    }

    const openOrg = (guild) => {
      state = {
        orgId: guild.orgId,
        guildId: guild.id,
        guildName: guild.name,
        guildIcon: guild.icon ?? null,
      };
      render();
    };

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
        guildsCache = null;
        openOrg({ ...guild, orgId });
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
          guildsCache = null;
          openOrg({ ...guild, orgId });
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

    // Show already-configured servers first so returning admins land on them.
    const sorted = [...guilds].sort(
      (a, b) => Number(Boolean(b.orgId)) - Number(Boolean(a.orgId)),
    );
    for (const guild of sorted) {
      const configured = Boolean(guild.orgId);
      const card = el(`
        <div class="server-card ${configured ? "is-configured" : ""}">
          <div class="server-id">
            ${serverAvatar(guild, 52)}
            <div class="server-meta">
              <strong>${escapeHtml(guild.name)}</strong>
              <span class="server-status ${configured ? "on" : ""}">
                <span class="dot"></span>${configured ? "Configured" : "Not added yet"}
              </span>
            </div>
          </div>
          <button class="${configured ? "btn-ghost" : "btn-primary"} server-action">${
            configured ? "Configure" : "Add to Discord"
          }</button>
        </div>
      `);
      const action = card.querySelector(".server-action");
      action.onclick = () => {
        if (configured) return openOrg(guild);
        finishInstallation(guild, action);
      };
      guildsEl.append(card);
    }
  }
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

async function renderOrg() {
  app.innerHTML = "";

  const back = el(`<button class="btn-ghost btn-back">← All servers</button>`);
  back.onclick = () => {
    state = { orgId: null };
    render();
  };
  app.append(back);

  const header = el(`
    <section class="card server-header">
      ${serverAvatar(
        { id: state.guildId, name: state.guildName || "Server", icon: state.guildIcon },
        46,
      )}
      <div class="server-header-text">
        <h2>${state.guildName ? escapeHtml(state.guildName) : "Your server"}</h2>
        <p class="hint">Manage the AIs and projects for this server. Changes save automatically.</p>
      </div>
    </section>
  `);
  app.append(header);

  const loadingCard = el(`<section class="card"><p class="muted">Loading setup…</p></section>`);
  app.append(loadingCard);

  let credentials = [];
  let projects = [];
  try {
    const [credRes, projRes] = await Promise.all([
      api(`/api/credentials?orgId=${state.orgId}`),
      api(`/api/projects?orgId=${state.orgId}`),
    ]);
    credentials = credRes.providers || [];
    projects = projRes.projects || [];
  } catch (error) {
    loadingCard.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    return;
  }
  loadingCard.remove();

  const progress = {
    connected: credentials.length > 0,
    projects: projects.length > 0,
  };
  const allDone = progress.connected && progress.projects;

  // The overview (lists + Add buttons) is the landing screen for a server. The
  // Connect AI / Create project / Ready wizard is entered via the Add buttons.
  if (orgView.orgId !== state.orgId) {
    orgView = {
      orgId: state.orgId,
      view: "overview",
      step: 1,
      editProjectName: null,
      openForm: false,
    };
  }

  const enterWizard = (step, editName = null) => {
    orgView.view = "wizard";
    orgView.step = step;
    orgView.editProjectName = editName;
    // Coming from an Add/Edit action, open the input form directly.
    orgView.openForm = true;
    renderOrg();
  };

  if (orgView.view === "overview") {
    renderOrgOverview({ credentials, projects, allDone, enterWizard });
    return;
  }

  // ----- Wizard view -----
  const backOverview = el(
    `<button class="btn-ghost btn-back">← Back to setup overview</button>`,
  );
  backOverview.onclick = () => {
    orgView.view = "overview";
    renderOrg();
  };
  app.append(backOverview);

  const steps = [
    { n: 1, label: "Connect AI", done: progress.connected },
    { n: 2, label: "Create a project", done: progress.projects },
    { n: 3, label: "Ready to use", done: allDone },
  ];
  const stepLocked = (n) =>
    (n === 2 && !progress.connected) || (n === 3 && !allDone);

  const goTo = (step) => {
    orgView.step = step;
    orgView.editProjectName = null;
    orgView.openForm = false;
    renderOrg();
  };

  const nav = el(`<div class="wizard-nav"></div>`);
  steps.forEach((s, index) => {
    const locked = stepLocked(s.n);
    const btn = el(`
      <button class="wizard-step ${orgView.step === s.n ? "active" : ""} ${
        s.done ? "done" : ""
      }" ${locked ? "disabled" : ""}>
        <span class="ws-badge">${s.done ? "✓" : s.n}</span>
        <span class="ws-label">${s.label}</span>
      </button>
    `);
    btn.onclick = () => {
      if (!locked) goTo(s.n);
    };
    nav.append(btn);
    if (index < steps.length - 1) nav.append(el(`<span class="wizard-sep"></span>`));
  });
  app.append(nav);

  const body = el(`<div id="wizard-body"></div>`);
  app.append(body);

  if (orgView.step === 1) {
    body.append(
      renderCredentialsCard(credentials, () => goTo(2), orgView.openForm),
    );
  } else if (orgView.step === 2) {
    body.append(
      await renderProjectsCard(
        projects,
        () => goTo(3),
        orgView.editProjectName,
        orgView.openForm,
      ),
    );
  } else {
    body.append(renderReadyCard(projects, goTo));
  }
}

/**
 * The server "home" screen: lists connected AIs and projects, each with an
 * Add button that jumps into the setup wizard.
 */
function renderOrgOverview({ credentials, projects, allDone, enterWizard }) {
  const aiCard = el(`
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Connected AIs</h2>
          <p class="hint">Providers with an API key saved for this server.</p>
        </div>
        <button class="btn-primary" id="ov-add-ai">+ Connect an AI</button>
      </div>
      <div class="list" id="ov-ai-list"></div>
    </section>
  `);
  const aiList = aiCard.querySelector("#ov-ai-list");
  if (credentials.length === 0) {
    aiList.innerHTML = `<p class="muted">No AIs connected yet. Connect one to get started.</p>`;
  } else {
    for (const providerId of credentials) {
      const providerName = displayNameFor(providerId);
      const item = el(`
        <div class="item">
          <span>${escapeHtml(providerName)} <span class="pill ok">connected</span></span>
        </div>
      `);
      const actions = el(`<div class="item-actions"></div>`);
      const del = el(`<button class="btn-danger">Remove</button>`);
      del.onclick = async () => {
        if (
          !confirm(
            `Remove the ${providerName} API key? Projects using it will stop working until another key is added.`,
          )
        ) {
          return;
        }
        del.disabled = true;
        try {
          await api(
            `/api/credentials?orgId=${state.orgId}&providerId=${encodeURIComponent(providerId)}`,
            { method: "DELETE" },
          );
          toast(`${providerName} key removed`);
          renderOrg();
        } catch (error) {
          del.disabled = false;
          toast(error.message, true);
        }
      };
      actions.append(del);
      item.append(actions);
      aiList.append(item);
    }
  }
  aiCard.querySelector("#ov-add-ai").onclick = () => enterWizard(1);
  app.append(aiCard);

  const projCard = el(`
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Projects</h2>
          <p class="hint">Each project connects an AI to the channels and roles allowed to use it.</p>
        </div>
        <button class="btn-primary" id="ov-add-proj">+ Add a project</button>
      </div>
      <div class="list" id="ov-proj-list"></div>
    </section>
  `);
  const projList = projCard.querySelector("#ov-proj-list");
  if (projects.length === 0) {
    projList.innerHTML = `<p class="muted">No projects yet. Add one so members can use <code>/agent</code>.</p>`;
  } else {
    for (const project of projects) {
      const scope = project.channelIds.length
        ? `${project.channelIds.length} channel(s)`
        : "whole server";
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
      edit.onclick = () => enterWizard(2, project.name);
      const del = el(`<button class="btn-danger">Remove</button>`);
      del.onclick = async () => {
        if (!confirm(`Remove project “${project.displayName || project.name}”?`)) return;
        del.disabled = true;
        try {
          await api(
            `/api/projects?orgId=${state.orgId}&name=${encodeURIComponent(project.name)}`,
            { method: "DELETE" },
          );
          renderOrg();
        } catch (error) {
          del.disabled = false;
          toast(error.message, true);
        }
      };
      actions.append(edit, del);
      item.append(actions);
      projList.append(item);
    }
  }
  projCard.querySelector("#ov-add-proj").onclick = () => {
    if (credentials.length === 0) {
      toast("Connect an AI first, then add a project.", true);
      enterWizard(1);
      return;
    }
    enterWizard(2, null);
  };
  app.append(projCard);

  if (allDone) {
    app.append(
      el(`
        <section class="card ready-card">
          <div class="ready-badge">✓</div>
          <h2>Relay is ready</h2>
          <p class="hint">Your team can use Relay in Discord right now.</p>
          <div class="ready-cmd"><span class="cm-slash">/agent</span> prompt: your question or task</div>
          <p class="hint">Need help? See the <a href="/guide.html">setup guide</a>.</p>
        </section>
      `),
    );
  }
}

function renderHelpCard() {
  return el(`
    <section class="card help-card">
      <h2>Help &amp; resources</h2>
      <p class="hint">Guides and answers to the most common setup questions.</p>
      <div class="help-grid">
        <a class="help-tile" href="/guide.html">
          <span class="help-ic">📖</span>
          <span class="help-tile-text"><strong>Setup guide</strong><span>Full step-by-step walkthrough</span></span>
        </a>
        <a class="help-tile" href="https://github.com/D-AZ0617/Discord-AI-Bot" target="_blank" rel="noopener">
          <span class="help-ic">🐙</span>
          <span class="help-tile-text"><strong>GitHub</strong><span>Source, issues &amp; updates</span></span>
        </a>
        <a class="help-tile" href="https://github.com/D-AZ0617/Discord-AI-Bot/issues/new" target="_blank" rel="noopener">
          <span class="help-ic">💬</span>
          <span class="help-tile-text"><strong>Report an issue</strong><span>Something not working?</span></span>
        </a>
      </div>
      <div class="faq help-faq">
        <details class="faq-item">
          <summary>What's the difference between a chat project and a coding project?</summary>
          <div class="faq-body">A <strong>chat</strong> project (ChatGPT, Gemini, Claude, or OpenRouter) answers questions right in the channel — no repo needed. A <strong>coding</strong> project (Cursor) runs a cloud agent on a GitHub repo and can open a pull request. Add whichever you need, or both.</div>
        </details>
        <details class="faq-item">
          <summary>Can members pick a different AI without changing the channel default?</summary>
          <div class="faq-body">Yes. Each channel has a default agent, but anyone with an allowed role for another agent can override it for a single prompt with <code>/agent-cursor</code>, <code>/agent-openrouter</code>, <code>/agent-chatgpt</code>, <code>/agent-claude</code>, or <code>/agent-gemini</code> (or the <code>project:</code> option). Everyone else keeps using the default until they choose otherwise.</div>
        </details>
        <details class="faq-item">
          <summary>Roles or channels aren't showing when I create a project</summary>
          <div class="faq-body">Relay reads them through its own bot account, so it must be added to the server. If you just installed it, reload this page. Servers where Relay isn't present show <strong>Add to Discord</strong> instead of <strong>Configure</strong>.</div>
        </details>
        <details class="faq-item">
          <summary>The bot doesn't respond to <code>/agent</code></summary>
          <div class="faq-body">Make sure you're in a channel the project is mapped to (or leave channels unchecked for the whole server), and that you have one of the project's allowed roles. Only permitted roles can use the bot.</div>
        </details>
        <details class="faq-item">
          <summary><code>@everyone</code> doesn't work as an allowed role</summary>
          <div class="faq-body">Discord never lists <code>@everyone</code> on members, so it can't be matched. Create a real role (e.g. <code>AI Access</code>), assign it to your team, and allow that role instead.</div>
        </details>
        <details class="faq-item">
          <summary>OpenRouter says the rate limit or quota was reached</summary>
          <div class="faq-body">Free models are rate-limited and can be busy. Set the project's model to <code>openrouter/free</code> so Relay routes to any available free model, or add credits on OpenRouter to raise the daily limit.</div>
        </details>
        <details class="faq-item">
          <summary>My API key stopped working</summary>
          <div class="faq-body">Re-add the key on the <strong>Connect AI</strong> step and use <strong>Test connection</strong> to confirm it. Keys are encrypted and never shown again, so replacing it is the way to rotate.</div>
        </details>
      </div>
    </section>
  `);
}

function renderCredentialsCard(initialConfigured, onFirstAdded, openForm = false) {
  const providers = providerList();

  // Coding agents we intend to support but haven't wired up yet. Shown as
  // disabled "coming soon" tiles so the category feels complete.
  const comingSoon = {
    coding: [
      { id: "codex", displayName: "Codex" },
      { id: "claude-code", displayName: "Claude Code" },
    ],
    chat: [],
  };
  const categories = {
    chat: {
      label: "💬 Generic AI Chatbot",
      desc: "Answers questions and chats right in your channels — no repo required.",
    },
    coding: {
      label: "⚡ Coding Agent",
      desc: "Works on a GitHub repo and can open pull requests.",
    },
  };
  const categoryOf = (p) => (p.kind === "repo" ? "coding" : "chat");
  const providersIn = (cat) => providers.filter((p) => categoryOf(p) === cat);

  const card = el(`
    <section class="card">
      <div class="step-head">
        <span class="step-index">Step 1</span>
        <h2>Connect an AI provider</h2>
      </div>
      <p class="hint">Bring your own key for the AI you want to use. Keys are encrypted before storage and never shown again.</p>
      <div id="cred-status" class="list"></div>
      <div class="add-row">
        <button class="btn-primary" id="cred-add" hidden>+ Connect another AI</button>
      </div>

      <div id="cred-form">
        <div class="divider"></div>
        <p class="picker-q">Which would you like to add?</p>
        <div class="segmented" id="cat-toggle">
          <button type="button" class="seg" data-cat="chat">${categories.chat.label}</button>
          <button type="button" class="seg" data-cat="coding">${categories.coding.label}</button>
        </div>
        <p class="hint" id="cat-desc"></p>

        <label>Choose an AI</label>
        <div class="provider-tiles" id="provider-tiles"></div>

        <p class="hint" id="cred-hint"></p>
        <label>API key</label>
        <input id="cred-key" type="password" placeholder="Paste your API key" autocomplete="off" />
        <div class="actions">
          <button class="btn-primary" id="cred-save">Save key</button>
          <button class="btn-ghost" id="cred-test">Test connection</button>
          <button class="btn-ghost" id="cred-cancel" hidden>Cancel</button>
        </div>
      </div>
      <div class="wizard-actions" id="cred-next-row" hidden>
        <button class="btn-primary" id="cred-next">Continue to projects →</button>
      </div>
    </section>
  `);

  const catToggle = card.querySelector("#cat-toggle");
  const catDesc = card.querySelector("#cat-desc");
  const tilesEl = card.querySelector("#provider-tiles");
  const hintEl = card.querySelector("#cred-hint");
  const nextRow = card.querySelector("#cred-next-row");
  const statusEl = card.querySelector("#cred-status");
  const addBtn = card.querySelector("#cred-add");
  const formEl = card.querySelector("#cred-form");
  const cancelBtn = card.querySelector("#cred-cancel");
  let hadAny = initialConfigured.length > 0;
  // Show the picker straight away for a fresh server or when opened via an Add
  // action; once something is connected, collapse it behind the button.
  let formOpen = !hadAny || openForm;

  const applyFormState = () => {
    formEl.hidden = !formOpen;
    addBtn.hidden = formOpen || !hadAny;
    cancelBtn.hidden = !hadAny;
    nextRow.hidden = !hadAny;
  };

  // Default to the chatbot category when it has providers (the easiest start),
  // otherwise fall back to whichever category does.
  let activeCat = providersIn("chat").length ? "chat" : "coding";
  let selectedProviderId = providersIn(activeCat)[0]?.id || null;

  const updateHint = () => {
    const p = providerById(selectedProviderId);
    hintEl.innerHTML = p?.apiKeyHint
      ? `Get your key from <strong>${escapeHtml(p.apiKeyHint)}</strong>.`
      : "";
  };

  const renderTiles = () => {
    catDesc.textContent = categories[activeCat].desc;
    catToggle.querySelectorAll(".seg").forEach((b) => {
      b.classList.toggle("active", b.dataset.cat === activeCat);
    });
    tilesEl.innerHTML = "";
    const live = providersIn(activeCat);
    for (const p of live) {
      const tile = el(`
        <button type="button" class="provider-tile ${
          selectedProviderId === p.id ? "selected" : ""
        }" data-provider="${escapeHtml(p.id)}">
          <span class="pt-name">${escapeHtml(p.displayName)}</span>
        </button>
      `);
      tile.onclick = () => {
        selectedProviderId = p.id;
        renderTiles();
        updateHint();
      };
      tilesEl.append(tile);
    }
    for (const soon of comingSoon[activeCat]) {
      tilesEl.append(
        el(`
        <button type="button" class="provider-tile is-soon" disabled>
          <span class="pt-name">${escapeHtml(soon.displayName)}</span>
          <span class="pt-soon">Coming soon</span>
        </button>
      `),
      );
    }
    if (!live.length) {
      tilesEl.append(
        el(
          `<p class="muted" style="margin:0">Nothing available in this category yet.</p>`,
        ),
      );
    }
  };

  catToggle.querySelectorAll(".seg").forEach((b) => {
    b.onclick = () => {
      activeCat = b.dataset.cat;
      const inCat = providersIn(activeCat);
      if (!inCat.some((p) => p.id === selectedProviderId)) {
        selectedProviderId = inCat[0]?.id || null;
      }
      renderTiles();
      updateHint();
    };
  });

  const renderList = (configured) => {
    hadAny = configured.length > 0;
    if (!hadAny) formOpen = true;
    applyFormState();
    statusEl.innerHTML = configured.length
      ? configured
          .map(
            (p) =>
              `<div class="item">
                <span>${escapeHtml(displayNameFor(p))} <span class="pill ok">connected</span></span>
                <button class="btn-danger cred-delete" data-provider="${escapeHtml(p)}">Remove</button>
              </div>`,
          )
          .join("")
      : `<p class="muted">No providers connected yet. Add one below to get started.</p>`;
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
  };

  const refresh = async () => {
    try {
      const { providers: configured } = await api(`/api/credentials?orgId=${state.orgId}`);
      renderList(configured);
    } catch (error) {
      statusEl.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  };

  addBtn.onclick = () => {
    formOpen = true;
    applyFormState();
    card.querySelector("#cred-key").focus({ preventScroll: true });
    formEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  cancelBtn.onclick = () => {
    card.querySelector("#cred-key").value = "";
    formOpen = false;
    applyFormState();
  };

  card.querySelector("#cred-next").onclick = () => {
    if (selectedProviderId) pendingProjectProvider = selectedProviderId;
    if (onFirstAdded) onFirstAdded();
  };

  card.querySelector("#cred-save").onclick = async () => {
    const providerId = selectedProviderId;
    if (!providerId) return toast("Choose an AI first", true);
    const keyEl = card.querySelector("#cred-key");
    const apiKey = keyEl.value.trim();
    if (!apiKey) return toast("Enter an API key", true);
    const wasEmpty = !hadAny;
    try {
      await api("/api/credentials", {
        method: "POST",
        body: JSON.stringify({ orgId: state.orgId, providerId, apiKey }),
      });
      keyEl.value = "";
      // Remember the choice so the project form opens on the matching fields.
      pendingProjectProvider = providerId;
      toast("Key saved");
      // Collapse back to the list after adding; refresh() reopens if now empty.
      formOpen = false;
      await refresh();
      // Guide first-time admins straight into creating their first project.
      if (wasEmpty && hadAny && onFirstAdded) onFirstAdded();
    } catch (error) {
      toast(error.message, true);
    }
  };

  card.querySelector("#cred-test").onclick = async () => {
    const providerId = selectedProviderId;
    if (!providerId) return toast("Choose an AI first", true);
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

  renderTiles();
  updateHint();
  renderList(initialConfigured);
  return card;
}

async function renderProjectsCard(initialProjects, onFirstAdded, editName, openForm = false) {
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
      <div class="step-head">
        <span class="step-index">Step 2</span>
        <h2>Create a project</h2>
      </div>
      <p class="hint">A project connects an AI (repo agent or chat model) to the channels and roles allowed to use it. Add as many as you like.</p>
      ${
        metaWarnings.length
          ? `<div class="callout warn">${metaWarnings.map(escapeHtml).join("<br>")}</div>`
          : ""
      }
      <div id="project-list" class="list"></div>
      <div class="add-row">
        <button class="btn-primary" id="p-add" hidden>+ Add a project</button>
      </div>
      <div id="p-form">
      <div class="divider"></div>
      <h3 id="p-form-title" class="form-subtitle">Add a project</h3>
      <label>Project name <span class="req">*</span></label>
      <input id="p-display" placeholder="Website Assistant" />
      <p class="hint">This is the name people will see in Discord.</p>
      <label>Provider</label>
      <select id="p-provider">${providerOptions}</select>

      <div id="p-repo-fields">
        <label>GitHub repo URL <span class="req">*</span></label>
        <input id="p-repo" placeholder="https://github.com/owner/repo" />
        <div class="row">
          <div><label>Default branch (optional)</label><input id="p-branch" placeholder="main" /></div>
        </div>
        <label><input type="checkbox" id="p-pr" checked style="width:auto;margin-right:8px" />Auto-create pull requests</label>
      </div>

      <div id="p-chat-fields" hidden>
        <label>Suggested model</label>
        <select id="p-model-picker"></select>
        <label>Model ID <span class="req">*</span></label>
        <input id="p-model" placeholder="model name" />
        <p class="hint" id="p-model-hint">Choose a suggestion above or type any model ID the provider supports.</p>
      </div>

      <label>Channels</label>
      ${channelControl}
      <label>Allowed roles <span class="req">*</span></label>
      ${roleControl}
      <div class="actions">
        <button class="btn-primary" id="p-save">Add project</button>
        <button class="btn-ghost" id="p-cancel" hidden>Cancel</button>
      </div>
      </div>
      <div class="wizard-actions" id="p-next-row" hidden>
        <button class="btn-primary" id="p-next">Finish setup →</button>
      </div>
    </section>
  `);

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
  const nextRow = card.querySelector("#p-next-row");
  const addBtn = card.querySelector("#p-add");
  const formEl = card.querySelector("#p-form");
  let projectsCache = initialProjects || [];
  let editingName = null;
  let projectNameCustomized = false;
  // Collapse the form behind an "Add a project" button once projects exist,
  // unless opened via an Add/Edit action.
  let formOpen = projectsCache.length === 0 || openForm;

  const applyFormState = () => {
    formEl.hidden = !formOpen;
    addBtn.hidden = formOpen || projectsCache.length === 0;
    nextRow.hidden = projectsCache.length === 0;
    // Cancel is only meaningful when there's a list to collapse back to.
    cancelBtn.hidden = !(formOpen && projectsCache.length > 0);
  };

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
    const preferred =
      pendingProjectProvider &&
      providers.some((p) => p.id === pendingProjectProvider)
        ? pendingProjectProvider
        : providers[0]?.id || "cursor";
    providerSel.value = preferred;
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
    formOpen = true;
    applyFormState();
    formEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  addBtn.onclick = () => {
    resetForm();
    formOpen = true;
    applyFormState();
    displayNameEl.focus({ preventScroll: true });
    formEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  cancelBtn.onclick = () => {
    resetForm();
    if (projectsCache.length > 0) formOpen = false;
    applyFormState();
  };

  const renderList = (projects) => {
    projectsCache = projects;
    if (projects.length === 0) formOpen = true;
    applyFormState();
    if (!editingName && !projectNameCustomized) useProviderAsProjectName();
    listEl.innerHTML = "";
    if (projects.length === 0) {
      listEl.innerHTML = `<p class="muted">No projects yet.</p>`;
      return;
    }
    for (const project of projects) {
      const scope = project.channelIds.length
        ? `${project.channelIds.length} channel(s)`
        : "whole server";
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
          await api(
            `/api/projects?orgId=${state.orgId}&name=${encodeURIComponent(project.name)}`,
            { method: "DELETE" },
          );
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
  };

  const refresh = async () => {
    try {
      const { projects } = await api(`/api/projects?orgId=${state.orgId}`);
      renderList(projects);
    } catch (error) {
      listEl.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  };

  card.querySelector("#p-next").onclick = () => onFirstAdded && onFirstAdded();

  const focusField = (id) => {
    const control = card.querySelector(`#${id}`);
    if (!control) return;
    control.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof control.focus === "function") control.focus({ preventScroll: true });
  };

  saveBtn.onclick = async () => {
    const enteredDisplayName = displayNameEl.value.trim();
    if (!enteredDisplayName) {
      toast("Enter a project name.", true);
      focusField("p-display");
      return;
    }
    const isChat = currentKind() === "chat";
    const repoUrl = isChat ? "" : card.querySelector("#p-repo").value.trim();
    const model = isChat ? modelEl.value.trim() : "";
    const allowedRoleIds = getIds("p-roles");

    // Enforce required fields client-side so the admin can't advance the wizard
    // with an incomplete project (the backend also validates as a backstop).
    if (!isChat && !repoUrl) {
      toast("Enter the GitHub repo URL for this coding agent.", true);
      focusField("p-repo");
      return;
    }
    if (isChat && !model) {
      toast("Choose or enter a model for this chatbot.", true);
      focusField("p-model");
      return;
    }
    if (allowedRoleIds.length === 0) {
      toast("Select at least one allowed role.", true);
      focusField("p-roles");
      return;
    }

    const displayName = editingName
      ? enteredDisplayName
      : uniqueProjectDisplayName(enteredDisplayName, projectsCache);
    const name =
      editingName ||
      projectSlug(displayName, new Set(projectsCache.map((project) => project.name)));
    const wasEmpty = projectsCache.length === 0;
    const project = {
      name,
      displayName,
      guildId: state.guildId,
      provider: providerSel.value || "cursor",
      channelIds: getIds("p-channels"),
      allowedRoleIds,
      repoUrl,
      defaultBranch: isChat
        ? undefined
        : card.querySelector("#p-branch").value.trim() || undefined,
      autoCreatePR: isChat ? false : card.querySelector("#p-pr").checked,
      providerOptions: isChat ? { model } : {},
    };

    saveBtn.disabled = true;
    try {
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({ orgId: state.orgId, project }),
      });
      const wasEditing = Boolean(editingName);
      toast(wasEditing ? "Project updated" : "Project added");
      resetForm();
      // Collapse back to the list after saving; refresh() reopens if now empty.
      formOpen = false;
      await refresh();
      // First project created during onboarding advances to the ready step.
      if (wasEmpty && !wasEditing && onFirstAdded) onFirstAdded();
    } catch (error) {
      toast(error.message, true);
    } finally {
      saveBtn.disabled = false;
    }
  };

  resetForm();
  renderList(projectsCache);
  // When opened via "Edit" from the overview, jump straight into that project.
  if (editName) {
    const target = projectsCache.find((p) => p.name === editName);
    if (target) loadForEdit(target);
  }
  return card;
}

function renderReadyCard(projects, goTo) {
  const list = projects
    .map(
      (p) =>
        `<li><strong>${escapeHtml(p.displayName || p.name)}</strong><span class="pill">${escapeHtml(
          displayNameFor(p.provider),
        )}</span></li>`,
    )
    .join("");

  const card = el(`
    <section class="card ready-card">
      <div class="ready-badge">✓</div>
      <h2>Relay is ready</h2>
      <p class="hint">Your team can start using Relay in Discord right now.</p>
      <div class="ready-cmd"><span class="cm-slash">/agent</span> prompt: your question or task</div>
      <h3 class="form-subtitle">Your projects</h3>
      <ul class="ready-list">${list || `<li class="muted">No projects yet.</li>`}</ul>
      <div class="wizard-actions">
        <button class="btn-ghost" id="ready-conn">Manage connections</button>
        <button class="btn-ghost" id="ready-proj">Manage projects</button>
      </div>
      <p class="hint">Need help? See the <a href="/guide.html">setup guide</a>.</p>
    </section>
  `);
  card.querySelector("#ready-conn").onclick = () => goTo(1);
  card.querySelector("#ready-proj").onclick = () => goTo(2);
  return card;
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
