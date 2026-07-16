/**
 * Fetch read-only context from a public GitHub repository for code-chat
 * providers. Uses the unauthenticated GitHub REST API (public repos only).
 */

const GITHUB_API = "https://api.github.com";
const MAX_TREE_PATHS = 400;
const MAX_FILE_BYTES = 50_000;
const MAX_TOTAL_FILE_BYTES = 200_000;
const MAX_SELECT_FILES = 8;

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".sql",
  ".sh",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
]);

const MANIFEST_PATHS = [
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
];

const SKIP_DIR_PREFIXES = [
  "node_modules/",
  "dist/",
  "build/",
  ".git/",
  "vendor/",
  "target/",
  ".next/",
  "coverage/",
  "__pycache__/",
];

export class GitHubContextError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GitHubContextError";
  }
}

export interface ParsedRepo {
  owner: string;
  repo: string;
}

export interface RepoSnapshot {
  owner: string;
  repo: string;
  ref: string;
  treePaths: string[];
  readme?: { path: string; content: string };
  manifests: Array<{ path: string; content: string }>;
}

export interface FetchedFile {
  path: string;
  content: string;
}

/** Parse https://github.com/owner/repo (optional .git / trailing slash). */
export function parseGitHubRepoUrl(repoUrl: string): ParsedRepo {
  let url: URL;
  try {
    url = new URL(repoUrl.trim());
  } catch {
    throw new GitHubContextError(
      "Invalid GitHub repository URL.",
      0,
      false,
    );
  }
  if (url.hostname !== "github.com") {
    throw new GitHubContextError(
      "Repository URL must be on github.com.",
      0,
      false,
    );
  }
  const parts = url.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new GitHubContextError(
      "Repository URL must look like https://github.com/owner/repo.",
      0,
      false,
    );
  }
  const owner = parts[0]!;
  const repo = parts[1]!;
  return { owner, repo };
}

export function filterTreePaths(paths: string[]): string[] {
  const filtered = paths.filter((path) => {
    if (!path || path.endsWith("/")) return false;
    const lower = path.toLowerCase();
    if (SKIP_DIR_PREFIXES.some((prefix) => lower.includes(prefix))) return false;
    const dot = path.lastIndexOf(".");
    if (dot < 0) return false;
    return SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
  });
  // Prefer shallower / shorter paths when capping.
  filtered.sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
  return filtered.slice(0, MAX_TREE_PATHS);
}

export function pickPathsFromModelReply(
  reply: string,
  allowed: Set<string>,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  // Prefer a JSON array if present.
  const jsonMatch = reply.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item !== "string") continue;
          const path = item.trim().replace(/^\.\//, "");
          if (allowed.has(path) && !seen.has(path)) {
            seen.add(path);
            paths.push(path);
          }
          if (paths.length >= MAX_SELECT_FILES) return paths;
        }
      }
    } catch {
      // Fall through to line scanning.
    }
  }

  for (const line of reply.split(/\r?\n/)) {
    const cleaned = line
      .replace(/^[-*\d.)\s]+/, "")
      .replace(/^["`']+|["`']+$/g, "")
      .trim()
      .replace(/^\.\//, "");
    if (!cleaned || cleaned.includes(" ")) continue;
    if (allowed.has(cleaned) && !seen.has(cleaned)) {
      seen.add(cleaned);
      paths.push(cleaned);
    }
    if (paths.length >= MAX_SELECT_FILES) break;
  }
  return paths;
}

async function githubJson(
  path: string,
  accept = "application/vnd.github+json",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        accept,
        "user-agent": "Relay-Discord-Bot",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitHubContextError(`GitHub network error: ${message}`, 0, true);
  }

  if (response.status === 404) {
    throw new GitHubContextError(
      "GitHub repository not found. It must be a public https://github.com/owner/repo URL.",
      404,
      false,
    );
  }
  if (response.status === 403 || response.status === 401) {
    const body = await response.text().catch(() => "");
    if (/rate limit/i.test(body) || response.headers.get("x-ratelimit-remaining") === "0") {
      throw new GitHubContextError(
        "GitHub API rate limit reached. Try again in a few minutes.",
        response.status,
        true,
      );
    }
    throw new GitHubContextError(
      "Cannot access that GitHub repository. Only public repos are supported for OpenRouter codebase Q&A (or use Cursor for private repos).",
      response.status,
      false,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GitHubContextError(
      `GitHub API failed: HTTP ${response.status} ${body.slice(0, 200)}`,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
  return response.json();
}

async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
  const data = (await githubJson(`/repos/${owner}/${repo}`)) as {
    default_branch?: string;
  };
  return data.default_branch?.trim() || "main";
}

async function fetchRawFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          accept: "application/vnd.github.raw+json",
          "user-agent": "Relay-Discord-Bot",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length > MAX_FILE_BYTES) {
    return `${text.slice(0, MAX_FILE_BYTES)}\n\n… [truncated at ${MAX_FILE_BYTES} bytes]`;
  }
  return text;
}

/** Load tree paths plus README and common manifests for a public repo. */
export async function loadRepoSnapshot(
  repoUrl: string,
  defaultBranch?: string,
): Promise<RepoSnapshot> {
  const { owner, repo } = parseGitHubRepoUrl(repoUrl);
  const ref = defaultBranch?.trim() || (await resolveDefaultBranch(owner, repo));

  const treeData = (await githubJson(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  )) as {
    tree?: Array<{ path?: string; type?: string }>;
    truncated?: boolean;
  };

  const allPaths = (treeData.tree ?? [])
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => entry.path as string);

  const treePaths = filterTreePaths(allPaths);

  const readmeCandidate =
    allPaths.find((p) => /^readme(\.|$)/i.test(p.split("/").pop() ?? "")) ??
    null;

  let readme: RepoSnapshot["readme"];
  if (readmeCandidate) {
    const content = await fetchRawFile(owner, repo, ref, readmeCandidate);
    if (content) readme = { path: readmeCandidate, content };
  }

  const manifests: RepoSnapshot["manifests"] = [];
  for (const manifest of MANIFEST_PATHS) {
    if (!allPaths.includes(manifest)) continue;
    const content = await fetchRawFile(owner, repo, ref, manifest);
    if (content) manifests.push({ path: manifest, content });
  }

  return { owner, repo, ref, treePaths, ...(readme ? { readme } : {}), manifests };
}

/** Fetch selected source files, respecting total byte budget. */
export async function fetchSelectedFiles(
  snapshot: RepoSnapshot,
  paths: string[],
): Promise<FetchedFile[]> {
  const allowed = new Set(snapshot.treePaths);
  const files: FetchedFile[] = [];
  let total = 0;

  for (const rawPath of paths) {
    const path = rawPath.trim().replace(/^\.\//, "");
    if (!allowed.has(path)) continue;
    const content = await fetchRawFile(
      snapshot.owner,
      snapshot.repo,
      snapshot.ref,
      path,
    );
    if (!content) continue;
    if (total + content.length > MAX_TOTAL_FILE_BYTES) break;
    total += content.length;
    files.push({ path, content });
    if (files.length >= MAX_SELECT_FILES) break;
  }
  return files;
}

export function formatTreeForPrompt(treePaths: string[]): string {
  return treePaths.join("\n");
}

export function formatFilesForPrompt(
  snapshot: RepoSnapshot,
  files: FetchedFile[],
): string {
  const parts: string[] = [];
  parts.push(
    `Repository: https://github.com/${snapshot.owner}/${snapshot.repo} (ref: ${snapshot.ref})`,
  );
  if (snapshot.readme) {
    parts.push(`\n### ${snapshot.readme.path}\n${snapshot.readme.content}`);
  }
  for (const manifest of snapshot.manifests) {
    parts.push(`\n### ${manifest.path}\n${manifest.content}`);
  }
  for (const file of files) {
    parts.push(`\n### ${file.path}\n${file.content}`);
  }
  return parts.join("\n");
}

export const CODE_CHAT_SYSTEM_PROMPT = `You are a read-only codebase assistant for a Discord bot.
Answer questions about the provided repository using only the file contents and tree given to you.
Explain how the code works, where things live, and how to understand the project.
Do NOT claim you edited files, committed, opened a pull request, or ran agents that change the repo.
If something is not in the provided context, say so clearly instead of inventing files.`;

export const FILE_PICK_SYSTEM_PROMPT = `You select which source files from a repository tree are most relevant to answer a user question.
Reply with a JSON array of file paths only (max ${MAX_SELECT_FILES}), using exact paths from the tree.
Example: ["src/index.ts","README.md"]
No commentary.`;
