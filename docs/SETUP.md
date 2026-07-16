# Setup Guide — Relay

Add **Relay** to your Discord server and let your team use AI with `/agent`.
Setup is **admin-only and one-time** (~5 min). Members just type `/agent` in a
configured channel.

> **Mental model:** Each **channel has exactly one Agent**. `/agent` always uses
> that channel’s agent. Want a different AI? Use a different channel (or change
> the channel’s agent in the dashboard).

---

## What you'll need

- **Manage Server** permission on your Discord server.
- An API key for at least one AI provider (bring your own):
  - **Chat:** OpenAI (ChatGPT), Google Gemini, or Anthropic (Claude)
  - **Codebase Q&A:** OpenRouter + a **public** GitHub repo URL
  - **Coding agents:** Cursor API key + GitHub repo connected to Cursor

---

## Step 1 — Add the bot to your server

1. Open the setup dashboard: **https://discord-agent-bot.d-az0617.workers.dev**
2. Click **Sign in with Discord** and authorize.
3. Find your server and click **Add to Discord**.

## Step 2 — Connect Cursor to GitHub (Cursor agents only)

Skip this if you only use chat or OpenRouter codebase Q&A.

1. Go to **https://cursor.com/dashboard → Integrations → GitHub**.
2. Install the **Cursor GitHub App** on the account/org that owns your repo.
3. Grant access to the repo(s) you'll use.

## Step 3 — Connect an AI provider

On **Connect AI**, choose Chatbot or Coding Agent, pick the AI, paste your key,
and click **Save key**.

| Provider | Use | Key |
|---|---|---|
| OpenAI / Gemini / Claude | Chat | Provider dashboard |
| OpenRouter (chat) | General chat — no repo | openrouter.ai → Keys |
| OpenRouter (codebase) | Read-only Q&A on a public repo | openrouter.ai → Keys (same key) |
| Cursor | Coding (edits + optional PRs) | cursor.com → API Keys |

## Step 4 — Create an agent

An **agent** is one AI setup assigned to channels.

| Field | What to enter |
|---|---|
| **Agent name** | Friendly label members see |
| **Provider** | The AI you connected |
| **GitHub / Model** | Repo URL and/or model (depends on provider) |
| **Channels** | **Required.** Pick channels, or click **All channels** |
| **Allowed roles** | At least one role ID (not `@everyone`) |

**Rules:**

- Each channel can have **only one** agent.
- **All channels** means this agent answers everywhere — you can’t also assign
  other agents to specific channels.
- Prefer one agent per channel when you want different AIs in different places.

### Getting Discord IDs

Enable **User Settings → Advanced → Developer Mode**, then copy Role / Channel IDs.

## Step 5 — Use it

In a channel that has an agent:

```
/agent prompt: what are good ways to structure a REST API?
```

| Command | What it does |
|---|---|
| `/agent prompt:<text>` | Ask this channel’s agent |
| `/agent-new prompt:<text>` | Fresh run (same agent) |
| `/agent-cancel` | Cancel the run in this channel |
| `/agent-status` | Recent runs here |
| `/agent-list` | Agents you can access |

---

## Troubleshooting

| Message | Fix |
|---|---|
| **"This channel has no agent…"** | Assign an agent to that channel (or use All channels). |
| **"You do not have an allowed role…"** | Add a real role (not `@everyone`) to the agent. |
| **"Channel … is already assigned…"** | Each channel has one agent — edit the other agent first. |
| **OpenRouter / public repo errors** | Repo must be public; URL must be saved on the OpenRouter agent. |

## Limits

- Limited **new** agents per user per hour; follow-ups are unlimited.
- One active run per channel+agent at a time.
