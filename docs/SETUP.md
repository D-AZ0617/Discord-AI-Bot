# Setup Guide — Discord AI Agent Bot

Add the bot to your Discord server and let your team run Cursor cloud agents on
your GitHub repos with `/agent`. Setup is **admin-only and one-time** (~5 min).
Regular members don't set up anything — they just type `/agent`.

> **What this bot does:** it runs [Cursor Cloud Agents](https://cursor.com) that
> clone a GitHub repo, work on it, and can open pull requests — all from Discord.
> So you'll connect a Cursor API key and at least one GitHub repo.

---

## What you'll need

- **Manage Server** permission on your Discord server.
- A **Cursor account** with cloud agents (an API key) — https://cursor.com
- At least one **GitHub repo**, with **GitHub connected to your Cursor account**.

---

## Step 1 — Add the bot to your server

1. Open the setup dashboard: **https://discord-agent-bot.d-az0617.workers.dev**
2. Click **Sign in with Discord** and authorize.
3. Click **Add to Discord**, pick your server, and approve the install.

## Step 2 — Connect Cursor to GitHub (once)

Cursor's cloud agent needs access to your repo to clone it and open PRs.

1. Go to **https://cursor.com/dashboard → Integrations → GitHub**.
2. Install/authorize the **Cursor GitHub App** on the account/org that owns your repo.
3. Grant access to the repo(s) you'll use (or "All repositories").

## Step 3 — Add your Cursor API key

1. In **https://cursor.com/dashboard → Settings → API Keys**, click **Create API
   Key**, and copy it (starts with `key_...`, shown once).
2. Back in the setup dashboard, select your server, then under **Provider keys**:
   - **Provider:** Cursor Cloud Agents
   - **API key:** paste your `key_...`
   - Click **Save key**, then **Test connection** → should say **Connection OK**.

> Your key is encrypted before storage and never displayed again.

## Step 4 — Create a project

A "project" maps a repo (and who can use it) to your server. Add as many as you like.

| Field | What to enter |
|---|---|
| **Slug** | short lowercase id, e.g. `main`, `api` (letters/numbers/hyphens only) |
| **Display name** | friendly label, e.g. `Main Repo` (optional) |
| **GitHub repo URL** | `https://github.com/owner/repo` (exact form, no extra path) |
| **Default branch** | optional, e.g. `main` |
| **Provider** | leave as `cursor` |
| **Channel IDs** | blank = whole server, or specific channel IDs |
| **Allowed role IDs** | at least one **role ID** allowed to use the bot |
| **Auto-create pull requests** | on if you want agents to open PRs |

Click **Save project**.

### Getting Discord IDs
Enable **User Settings → Advanced → Developer Mode**, then:
- **Role ID:** Server Settings → Roles → right-click a role → **Copy Role ID**.
- **Channel ID:** right-click a channel → **Copy Channel ID**.

> **Important — `@everyone` doesn't work as an allowed role.** Discord never lists
> the `@everyone` role on members, so it can't be matched. To allow your whole
> team, create a real role (e.g. `AI Access`), assign it to members, and use that
> role's ID.

### Multiple repos
Just create one project per repo. Members choose which repo by:
- **Channel:** map each repo to its own channel(s), or
- **Command option:** leave channels blank and pass `project:` (with autocomplete),
  e.g. `/agent prompt: ... project: api`.

## Step 5 — Use it

In a mapped channel (with your allowed role):

```
/agent prompt: summarize what this repository does
```

You'll see a **Started** embed that updates to **Running** → **Finished**.

| Command | What it does |
|---|---|
| `/agent prompt:<text> [project:<slug>]` | Start, or continue this channel's agent |
| `/agent-new prompt:<text> [project:<slug>]` | Always start a fresh agent |
| `/agent-status` | Recent agents/runs in this channel/thread |
| `/agent-projects` | Projects you can access |

`/cursor*` are aliases for the same commands.

---

## Troubleshooting

| Message | Cause & fix |
|---|---|
| **"This server is not configured yet."** | Finish Steps 1–4 in the dashboard. |
| **"You do not have an allowed role…"** | Your role isn't in the project's allowed roles. `@everyone` won't work — use a real role ID (see Step 4). |
| **"No `cursor` API key is configured…"** | Add and save your Cursor key (Step 3). |
| **Save says "Invalid project"** | Slug must be lowercase; repo URL must be `https://github.com/owner/repo`; role/channel IDs must be numeric Discord IDs (17–20 digits). |
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
