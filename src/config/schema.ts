export interface ProjectConfig {
  name: string;
  displayName?: string;
  guildId: string;
  channelIds: string[];
  allowedRoleIds: string[];
  provider: string;
  providerOptions: Record<string, unknown>;
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
  const repoUrl = readString(raw.repoUrl, `${path}.repoUrl`, errors);
  const provider =
    raw.provider === undefined
      ? "cursor"
      : readString(raw.provider, `${path}.provider`, errors);
  const channelIds =
    raw.channelIds === undefined
      ? []
      : readStringArray(raw.channelIds, `${path}.channelIds`, errors);
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
  const routes = new Set<string>();
  for (const project of validProjects) {
    if (names.has(project.name)) {
      errors.push(`Duplicate project name: ${project.name}`);
    }
    names.add(project.name);
    for (const channelId of project.channelIds) {
      const route = `${project.guildId}:${channelId}`;
      if (routes.has(route)) {
        errors.push(`Channel ${channelId} is assigned to more than one project`);
      }
      routes.add(route);
    }
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
