import type { FetchedFile, RecentCommit, RepoSnapshot } from "./github-context.js";

/** How long cached repo context is reused for follow-ups in the same channel. */
export const CODE_CHAT_CACHE_TTL_MS = 45 * 60 * 1000;

/** Refresh commit list if the cache entry is older than this. */
export const CODE_CHAT_COMMIT_REFRESH_MS = 5 * 60 * 1000;

const CACHE_PREFIX = "https://relay.code-context.cache/";

export interface CodeChatCacheEntry {
  repoUrl: string;
  ref: string;
  treePaths: string[];
  readme?: { path: string; content: string };
  manifests: Array<{ path: string; content: string }>;
  commits: RecentCommit[];
  files: FetchedFile[];
  savedAt: number;
}

export function codeChatCacheKey(
  orgId: string,
  contextId: string,
  projectName: string,
): string {
  return `${orgId}:${contextId}:${projectName}`;
}

export function snapshotFromCache(entry: CodeChatCacheEntry): RepoSnapshot {
  const { owner, repo } = parseOwnerRepo(entry.repoUrl);
  return {
    owner,
    repo,
    ref: entry.ref,
    treePaths: entry.treePaths,
    ...(entry.readme ? { readme: entry.readme } : {}),
    manifests: entry.manifests,
  };
}

function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } {
  const url = new URL(repoUrl.trim());
  const parts = url.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
  return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
}

export async function readCodeChatCache(
  key: string,
): Promise<CodeChatCacheEntry | null> {
  if (typeof caches === "undefined") return null;
  const cache = caches.default;
  const response = await cache.match(
    new Request(`${CACHE_PREFIX}${encodeURIComponent(key)}`),
  );
  if (!response) return null;
  try {
    const entry = (await response.json()) as CodeChatCacheEntry;
    if (!entry?.repoUrl || !entry.ref || !Array.isArray(entry.treePaths)) {
      return null;
    }
    if (Date.now() - entry.savedAt > CODE_CHAT_CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

export async function writeCodeChatCache(
  key: string,
  entry: CodeChatCacheEntry,
): Promise<void> {
  if (typeof caches === "undefined") return;
  const cache = caches.default;
  const request = new Request(`${CACHE_PREFIX}${encodeURIComponent(key)}`);
  const response = new Response(JSON.stringify(entry), {
    headers: {
      "content-type": "application/json",
      "cache-control": `max-age=${Math.floor(CODE_CHAT_CACHE_TTL_MS / 1000)}`,
    },
  });
  await cache.put(request, response);
}
