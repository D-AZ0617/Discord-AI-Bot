import type { StoredProject } from "../db/types.js";

export interface AccessRequest {
  guildId: string | null;
  /** Parent channel id (threads route to their parent). */
  routeChannelId: string;
  roleIds: ReadonlySet<string>;
  requestedProject?: string | null;
  /**
   * Provider id for a per-prompt AI override (e.g. `/agent-cursor`). When set
   * (and no explicit `requestedProject`), resolution is limited to the caller's
   * accessible projects that use this provider.
   */
  requestedProvider?: string | null;
  /** Human-readable provider name, used only for error messages. */
  requestedProviderLabel?: string | null;
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
      request.requestedProvider &&
      project.provider !== request.requestedProvider
    ) {
      const label = request.requestedProviderLabel ?? request.requestedProvider;
      return {
        allowed: false,
        message: `Project \`${project.name}\` is not a ${label} agent.`,
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
  } else if (request.requestedProvider) {
    const providerResult = resolveProviderOverride(guildProjects, request);
    if (!providerResult.allowed) return providerResult;
    // Access already verified against roles here; return immediately.
    return providerResult;
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

/**
 * Resolves a per-prompt provider override (e.g. `/agent-cursor`). Picks among
 * the caller's accessible projects for the requested provider using the
 * "channel-mapped first, otherwise ask" rule:
 *   1. a project of that provider mapped to this channel, else
 *   2. the single guild-wide project of that provider, else
 *   3. ask for an explicit `project:` (ambiguous or not available here).
 * Only projects the caller can access (by role) are considered, so the returned
 * project has already passed the role check.
 */
function resolveProviderOverride(
  guildProjects: StoredProject[],
  request: AccessRequest,
): AccessResult {
  const providerId = request.requestedProvider!;
  const label = request.requestedProviderLabel ?? providerId;

  const candidates = guildProjects.filter((p) => p.provider === providerId);
  if (candidates.length === 0) {
    return {
      allowed: false,
      message: `No ${label} agent is configured in this server.`,
    };
  }

  const accessible = candidates.filter((p) =>
    p.allowedRoleIds.some((roleId) => request.roleIds.has(roleId)),
  );
  if (accessible.length === 0) {
    return {
      allowed: false,
      message: `You do not have an allowed role for a ${label} agent here.`,
    };
  }

  const channelMapped = accessible.find((p) =>
    p.channelIds.includes(request.routeChannelId),
  );
  if (channelMapped) {
    return { allowed: true, project: channelMapped };
  }

  const guildWide = accessible.filter((p) => p.channelIds.length === 0);
  if (guildWide.length === 1) {
    return { allowed: true, project: guildWide[0]! };
  }
  if (guildWide.length > 1) {
    return {
      allowed: false,
      message: `You have more than one ${label} agent. Add the \`project\` option to choose one.`,
    };
  }
  return {
    allowed: false,
    message: `Your ${label} agent isn't available in this channel. Add the \`project\` option to choose one.`,
  };
}
