export type ChannelScope = "all" | "selected";

export interface ProjectConfig {
  name: string;
  displayName?: string;
  guildId: string;
  /**
   * Where this agent runs:
   * - `all` — every channel in the server (`channelIds` must be empty)
   * - `selected` — only the listed channels (`channelIds` must be non-empty)
   */
  channelScope: ChannelScope;
  channelIds: string[];
  allowedRoleIds: string[];
  provider: string;
  providerOptions: Record<string, unknown>;
  /** Repo to work on. Empty for chat providers that don't use a repository. */
  repoUrl: string;
  defaultBranch?: string;
  autoCreatePR: boolean;
}

export interface ProjectsConfig {
  version: 1;
  projects: ProjectConfig[];
}

export interface ProjectInputResult {
  ok: boolean;
  errors: string[];
  project?: ProjectConfig;
}

const snowflakePattern = /^\d{17,20}$/;
const projectNamePattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function isAllChannelsAgent(project: Pick<ProjectConfig, "channelScope" | "channelIds">): boolean {
  return project.channelScope === "all" || project.channelIds.length === 0;
}

/** Normalize legacy rows that only stored empty channelIds as guild-wide. */
export function withChannelScope<
  T extends Omit<ProjectConfig, "channelScope"> & { channelScope?: ChannelScope },
>(project: T): T & ProjectConfig {
  const channelScope: ChannelScope =
    project.channelScope ??
    (project.channelIds.length === 0 ? "all" : "selected");
  return {
    ...project,
    channelScope,
    channelIds: channelScope === "all" ? [] : project.channelIds,
  };
}

/**
 * Cross-agent channel rules for one guild: either a single All-channels agent,
 * or selected-channel agents with disjoint channel sets — never both, never overlap.
 */
export function channelAssignmentErrors(
  agents: ProjectConfig[],
  candidate: ProjectConfig,
  excludeName?: string,
): string[] {
  const others = agents.filter(
    (agent) =>
      agent.guildId === candidate.guildId &&
      agent.name !== (excludeName ?? candidate.name),
  );
  const errors: string[] = [];
  const candidateAll = isAllChannelsAgent(candidate);
  const otherAll = others.find((agent) => isAllChannelsAgent(agent));

  if (candidateAll && otherAll) {
    errors.push(
      `Only one All-channels agent is allowed. “${otherAll.displayName ?? otherAll.name}” already covers every channel.`,
    );
  }
  if (candidateAll && others.some((agent) => !isAllChannelsAgent(agent))) {
    const names = others
      .filter((agent) => !isAllChannelsAgent(agent))
      .map((agent) => agent.displayName ?? agent.name)
      .join(", ");
    errors.push(
      `Cannot use All channels while other agents are assigned to specific channels (${names}). Remove those channel assignments first, or assign this agent to specific channels instead.`,
    );
  }
  if (!candidateAll && otherAll) {
    errors.push(
      `“${otherAll.displayName ?? otherAll.name}” already covers All channels. Remove it or switch it to specific channels before assigning this agent.`,
    );
  }
  if (!candidateAll) {
    for (const channelId of candidate.channelIds) {
      const owner = others.find(
        (agent) =>
          !isAllChannelsAgent(agent) && agent.channelIds.includes(channelId),
      );
      if (owner) {
        errors.push(
          `Channel ${channelId} is already assigned to “${owner.displayName ?? owner.name}”. Each channel can have only one agent.`,
        );
      }
    }
  }
  return errors;
}

function validateProject(
  raw: unknown,
  path: string,
  errors: string[],
): ProjectConfig | null {
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  const name = readString(raw.name, `${path}.name`, errors);
  const guildId = readString(raw.guildId, `${path}.guildId`, errors);
  // Repo is optional at the schema level (chat providers don't use one); the
  // provider registry enforces whether a given provider requires it.
  const repoUrl =
    typeof raw.repoUrl === "string" ? raw.repoUrl.trim() : "";
  const provider =
    raw.provider === undefined
      ? "cursor"
      : readString(raw.provider, `${path}.provider`, errors);
  const rawChannelIds =
    raw.channelIds === undefined
      ? []
      : readStringArray(raw.channelIds, `${path}.channelIds`, errors);
  // Treat the server (guild) ID entered in the channels field as "whole server".
  const filteredChannelIds = rawChannelIds.filter((id) => id !== guildId);

  let channelScope: ChannelScope;
  if (raw.channelScope === "all" || raw.channelScope === "selected") {
    channelScope = raw.channelScope;
  } else if (raw.channelScope !== undefined) {
    errors.push(`${path}.channelScope must be "all" or "selected"`);
    channelScope = filteredChannelIds.length === 0 ? "all" : "selected";
  } else {
    // Legacy payloads: empty channels meant guild-wide.
    channelScope = filteredChannelIds.length === 0 ? "all" : "selected";
  }

  const channelIds = channelScope === "all" ? [] : filteredChannelIds;
  if (channelScope === "selected" && channelIds.length === 0) {
    errors.push(
      `${path}: select at least one channel, or choose All channels`,
    );
  }

  const allowedRoleIds = readStringArray(
    raw.allowedRoleIds,
    `${path}.allowedRoleIds`,
    errors,
  );

  if (name && !projectNamePattern.test(name)) {
    errors.push(`${path}.name must be a lowercase slug of up to 32 characters`);
  }
  if (provider && !projectNamePattern.test(provider)) {
    errors.push(`${path}.provider must be a lowercase slug of up to 32 characters`);
  }
  if (raw.providerOptions !== undefined && !isRecord(raw.providerOptions)) {
    errors.push(`${path}.providerOptions must be a JSON object`);
  }
  validateSnowflake(guildId, `${path}.guildId`, errors);
  channelIds.forEach((id, i) =>
    validateSnowflake(id, `${path}.channelIds[${i}]`, errors),
  );
  allowedRoleIds.forEach((id, i) =>
    validateSnowflake(id, `${path}.allowedRoleIds[${i}]`, errors),
  );
  if (allowedRoleIds.length === 0) {
    errors.push(`${path}.allowedRoleIds must contain at least one role`);
  }
  if (repoUrl && !isGitHubRepoUrl(repoUrl)) {
    errors.push(`${path}.repoUrl must be an https://github.com/owner/repo URL`);
  }

  return {
    name,
    ...(typeof raw.displayName === "string"
      ? { displayName: raw.displayName.trim() }
      : {}),
    guildId,
    channelScope,
    channelIds,
    allowedRoleIds,
    provider,
    providerOptions: isRecord(raw.providerOptions) ? raw.providerOptions : {},
    repoUrl,
    ...(typeof raw.defaultBranch === "string" && raw.defaultBranch.trim()
      ? { defaultBranch: raw.defaultBranch.trim() }
      : {}),
    autoCreatePR:
      typeof raw.autoCreatePR === "boolean" ? raw.autoCreatePR : true,
  } satisfies ProjectConfig;
}

/** Validate a single project payload, used by the onboarding dashboard API. */
export function validateProjectInput(raw: unknown): ProjectInputResult {
  const errors: string[] = [];
  const project = validateProject(raw, "project", errors);
  if (!project || errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, errors: [], project };
}

export function validateProjectsConfig(value: unknown): ProjectsConfig {
  const errors: string[] = [];
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.projects)) {
    throw new Error("Config must contain { version: 1, projects: [...] }.");
  }

  const projects = value.projects.map((raw, index) =>
    validateProject(raw, `projects[${index}]`, errors),
  );

  const validProjects = projects.filter(
    (project): project is ProjectConfig => project !== null,
  );
  const names = new Set<string>();
  for (const project of validProjects) {
    if (names.has(project.name)) {
      errors.push(`Duplicate project name: ${project.name}`);
    }
    names.add(project.name);
    errors.push(
      ...channelAssignmentErrors(validProjects, project).map(
        (message) => `${project.name}: ${message}`,
      ),
    );
  }

  if (validProjects.length === 0) errors.push("At least one project is required");
  if (errors.length > 0) {
    throw new Error(`Invalid projects config:\n- ${errors.join("\n- ")}`);
  }
  return { version: 1, projects: validProjects };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  value: unknown,
  path: string,
  errors: string[],
): string {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function readStringArray(
  value: unknown,
  path: string,
  errors: string[],
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  const result = value.filter((item): item is string => typeof item === "string");
  if (result.length !== value.length) errors.push(`${path} must contain only strings`);
  return result.map((item) => item.trim());
}

function validateSnowflake(
  value: string,
  path: string,
  errors: string[],
): void {
  if (value && !snowflakePattern.test(value)) {
    errors.push(`${path} must be a Discord ID (17-20 digits)`);
  }
}

function isGitHubRepoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.split("/").filter(Boolean).length === 2
    );
  } catch {
    return false;
  }
}
