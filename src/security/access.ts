import type { StoredProject } from "../db/types.js";

export interface AccessRequest {
  guildId: string | null;
  /** Parent channel id (threads route to their parent). */
  routeChannelId: string;
  roleIds: ReadonlySet<string>;
  requestedProject?: string | null;
}

export type AccessResult =
  | { allowed: true; project: StoredProject }
  | { allowed: false; message: string };

/**
 * Pure access-control resolution. `guildProjects` must already be scoped to the
 * caller's guild (loaded per tenant), which keeps tenant isolation at the data
 * layer and makes this logic trivially testable.
 */
export function resolveProjectAccess(
  guildProjects: StoredProject[],
  request: AccessRequest,
): AccessResult {
  if (!request.guildId) {
    return {
      allowed: false,
      message: "This bot only works in configured Discord servers.",
    };
  }
  if (guildProjects.length === 0) {
    return {
      allowed: false,
      message: "This Discord server is not configured yet.",
    };
  }

  let project: StoredProject | undefined;
  if (request.requestedProject) {
    project = guildProjects.find((p) => p.name === request.requestedProject);
    if (!project) {
      return {
        allowed: false,
        message: `Project \`${request.requestedProject}\` is not configured in this server.`,
      };
    }
    if (
      project.channelIds.length > 0 &&
      !project.channelIds.includes(request.routeChannelId)
    ) {
      return {
        allowed: false,
        message: `Project \`${project.name}\` cannot be used in this channel.`,
      };
    }
  } else {
    project = guildProjects.find(
      (p) => p.channelIds.includes(request.routeChannelId),
    );
    if (!project) {
      const guildWide = guildProjects.filter((p) => p.channelIds.length === 0);
      if (guildWide.length === 1) {
        project = guildWide[0]!;
      } else {
        return {
          allowed: false,
          message:
            guildWide.length > 1
              ? "Choose a project with the `project` option."
              : "This channel is not mapped to a project.",
        };
      }
    }
  }

  if (!project.allowedRoleIds.some((roleId) => request.roleIds.has(roleId))) {
    return {
      allowed: false,
      message: `You do not have an allowed role for **${project.displayName ?? project.name}**.`,
    };
  }

  return { allowed: true, project };
}

export function projectsVisibleToCaller(
  guildProjects: StoredProject[],
  roleIds: ReadonlySet<string>,
): StoredProject[] {
  return guildProjects.filter((project) =>
    project.allowedRoleIds.some((role) => roleIds.has(role)),
  );
}
