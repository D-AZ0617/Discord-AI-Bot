import type { StoredProject } from "../db/types.js";
import {
  isAllChannelsAgent,
  withChannelScope,
} from "../config/schema.js";

export interface AccessRequest {
  guildId: string | null;
  /** Parent channel id (threads route to their parent). */
  routeChannelId: string;
  roleIds: ReadonlySet<string>;
}

export type AccessResult =
  | { allowed: true; project: StoredProject }
  | { allowed: false; message: string };

/**
 * Resolve the single Agent for this channel. Each channel has at most one
 * Agent (selected channels or one All-channels Agent). Tenant isolation stays
 * at the data layer (`guildProjects` is already scoped).
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

  const agents = guildProjects.map((project) => withChannelScope(project));

  const channelMapped = agents.filter(
    (agent) =>
      !isAllChannelsAgent(agent) &&
      agent.channelIds.includes(request.routeChannelId),
  );
  if (channelMapped.length > 1) {
    return {
      allowed: false,
      message:
        "This channel is assigned to more than one agent. An administrator must fix overlapping channels in the dashboard.",
    };
  }

  let project = channelMapped[0];
  if (!project) {
    const allChannels = agents.filter((agent) => isAllChannelsAgent(agent));
    if (allChannels.length === 1) {
      project = allChannels[0]!;
    } else if (allChannels.length > 1) {
      return {
        allowed: false,
        message:
          "More than one All-channels agent is configured. An administrator must keep only one in the dashboard.",
      };
    } else {
      return {
        allowed: false,
        message:
          "This channel has no agent. An administrator can assign one in the Relay dashboard.",
      };
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
