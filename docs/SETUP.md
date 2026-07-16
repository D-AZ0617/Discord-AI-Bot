# Setup Guide — Relay

Add **Relay** to your Discord server and let your team use AI with `/agent` —
whatever they need it for. Setup is **admin-only and one-time** (~5 min). Regular
members don't set up anything — they just type `/agent`.

> **What this bot does:** Relay brings AI into Discord in two ways, and you can use
> either or both:
>
> - **Chat** — ask questions and get answers from ChatGPT, Gemini, Claude, or
>   OpenRouter (including free models) right in the channel. No repo or code involved.
> - **Code** — hand a task to a [Cursor cloud agent](https://cursor.com) that clones
>   a GitHub repo, works on it, and can open a pull request.
>
> You only set up the parts you want. A chat-only server never needs a repo or a
> Cursor key; a coding server does.

---

## What you'll need

- **Manage Server** permission on your Discord server.
- An API key for at least one AI provider (bring your own):
  - **For chatting:** OpenAI (ChatGPT), Google Gemini, Anthropic (Claude), or
    OpenRouter (many free models) — no repo required. OpenRouter is the quickest,
    cheapest way to start.
  - **For coding:** a **Cursor account** with cloud agents (an API key) —
    https://cursor.com — plus at least one **GitHub repo** connected to Cursor.

---

## Step 1 — Add the bot to your server

1. Open the setup dashboard: **https://discord-agent-bot.d-az0617.workers.dev**
2. Click **Sign in with Discord** and authorize.
3. Find your server and click **Add to Discord**. Relay prefills that server;
   approve the install to continue setup automatically. Already-installed
   servers show **Configure** instead.

## Step 2 — Connect Cursor to GitHub (coding only, once)

> Only setting up chat (ChatGPT, Gemini, Claude, OpenRouter)? Skip this step and
> go straight to Step 3.

Cursor's cloud agent needs access to your repo to clone it and open PRs.

1. Go to **https://cursor.com/dashboard → Integrations → GitHub**.
2. Install/authorize the **Cursor GitHub App** on the account/org that owns your repo.
3. Grant access to the repo(s) you'll use (or "All repositories").

## Step 3 — Connect an AI provider

Opening a server starts a guided setup with three steps: **Connect AI**,
**Create a project**, and **Ready to use**. You can revisit any step later to
manage connections and projects.

On the **Connect AI** step, first choose what you're adding — **Generic AI
Chatbot** or **Coding Agent** — then pick the specific AI, paste your key, click
**Save key** (optionally **Test connection** → **Connection OK**), and Relay
advances you automatically. Add a key for each AI you want to use.

| Provider | Use | Where to get the key |
|---|---|---|
| OpenRouter (free models) | Chat | openrouter.ai → Keys |
| OpenAI (ChatGPT) | Chat | platform.openai.com → API keys |
| Google Gemini | Chat | aistudio.google.com → Get API key |
| Anthropic (Claude) | Chat | console.anthropic.com → API keys |
| Cursor Cloud Agents | Coding | cursor.com/dashboard → Settings → API Keys (starts with `key_...`) |

> Your key is encrypted before storage and never displayed again.

## Step 4 — Create a project

On the **Create a project** step, a "project" maps an AI (and who can use it) to
your server. Pick a **Provider** first; the form then shows the right fields. Add
as many as you like, then finish to reach **Ready to use**.

| Field | What to enter |
|---|---|
| **Project name** | defaults to the selected AI provider's name. You can replace it with any friendly label; Relay creates the internal project ID automatically. |
| **Provider** | choose Cursor (repo work) or a chat model (ChatGPT, Gemini, Claude, OpenRouter) |
| **GitHub repo URL** *(Cursor)* | `https://github.com/owner/repo` (exact form, no extra path) |
| **Default branch** *(Cursor)* | optional, e.g. `main` |
| **Model** *(chat)* | pick a suggested model or type any model id the provider supports |
| **Channel IDs** | blank = whole server, or specific channel IDs |
| **Allowed role IDs** | at least one **role ID** allowed to use the bot |
| **Auto-create pull requests** *(Cursor)* | on if you want agents to open PRs |

Click **Save project**.

### Getting Discord IDs
Enable **User Settings → Advanced → Developer Mode**, then:
- **Role ID:** Server Settings → Roles → right-click a role → **Copy Role ID**.
- **Channel ID:** right-click a channel → **Copy Channel ID**.

> **Important — `@everyone` doesn't work as an allowed role.** Discord never lists
> the `@everyone` role on members, so it can't be matched. To allow your whole
> team, create a real role (e.g. `AI Access`), assign it to members, and use that
> role's ID.

### Multiple projects
Add as many projects as you like — for example a chat model in one channel and a
Cursor coding agent in another, or several repos. Members choose which project by:
- **Channel:** map each project to its own channel(s), or
- **Command option:** leave channels blank and pass `project:` (with autocomplete),
  e.g. `/agent prompt: ... project: api`.

## Step 5 — Use it

In a mapped channel (with your allowed role), just type `/agent`:

```
# Chat
/agent prompt: what are good ways to structure a REST API?

# Coding
/agent prompt: summarize what this repository does
```

For coding runs you'll see a **Started** embed that updates to **Running** →
**Finished**; chat replies come back in the channel.

| Command | What it does |
|---|---|
| `/agent prompt:<text> [project:<slug>]` | Start, or continue this channel's agent |
| `/agent-new prompt:<text> [project:<slug>]` | Always start a fresh agent |
| `/agent-cancel [project:<slug>]` | Cancel the agent running in this channel and unlock it |
| `/agent-status` | Recent agents/runs in this channel/thread |
| `/agent-projects` | Projects you can access |

`/cursor*` are aliases for the same commands.

### Switch AI for a single prompt

Each channel has a default agent (the project mapped to it, or the server-wide
one). Anyone with an allowed role for another agent can override it **for one
prompt** — without changing the default for everyone else:

- **Per-AI commands:** `/agent-cursor`, `/agent-openrouter`, `/agent-chatgpt`,
  `/agent-claude`, `/agent-gemini` — each runs your prompt with that AI's project.
- **The `project:` option:** on any `/agent` command, e.g.
  `/agent prompt: … project: relay` (autocomplete lists the projects you can use).

> Example: a channel defaults to OpenRouter for chat. A developer with the Cursor
> role runs `/agent-cursor prompt: fix the failing test` to use the repo for that
> one prompt; everyone else keeps chatting with OpenRouter. If you have more than
> one project on the same AI, add `project:` to pick which one.

---

## Troubleshooting

| Message | Cause & fix |
|---|---|
| **"This server is not configured yet."** | Finish Steps 1–4 in the dashboard. |
| **"You do not have an allowed role…"** | Your role isn't in the project's allowed roles. `@everyone` won't work — use a real role ID (see Step 4). |
| **"No `cursor` API key is configured…"** | Add and save your Cursor key (Step 3). |
| **Save says "Invalid project"** | Repo URL must be `https://github.com/owner/repo`; role/channel IDs must be numeric Discord IDs (17–20 digits). |
| **"The SCM integration does not have access to repository…"** | Connect the Cursor GitHub App to that repo (Step 2). |
| **"Discord is rate-limiting the server list."** | Wait ~60s and refresh; avoid rapid re-sign-ins. |
| **Agent starts but errors immediately** | Check the Cursor key is valid and the repo/branch exists and is accessible to Cursor. |

## Limits & notes

- Each user can start a limited number of **new** agents per hour (default 5);
  follow-ups are unlimited.
- One active run per channel+project at a time — wait for it to finish before
  starting another there.
- Follow-up prompts in the same channel continue the same agent; use `/agent-new`
  to force a fresh one.
