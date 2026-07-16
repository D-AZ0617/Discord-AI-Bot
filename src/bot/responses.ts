import type { AgentRun } from "../agents/types.js";
import type { ProjectConfig } from "../config/schema.js";
import type { DiscordEmbed } from "../discord/interactions.js";

const statusLabels: Record<AgentRun["status"], string> = {
  CREATING: "Started",
  RUNNING: "Running",
  FINISHED: "Finished",
  ERROR: "Failed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

const statusColors: Record<AgentRun["status"], number> = {
  CREATING: 0xf1c40f,
  RUNNING: 0x3498db,
  FINISHED: 0x2ecc71,
  ERROR: 0xe74c3c,
  CANCELLED: 0x95a5a6,
  EXPIRED: 0x95a5a6,
};

export function runEmbed(
  run: AgentRun,
  project: Pick<ProjectConfig, "name" | "displayName">,
  providerDisplayName: string,
  agentUrl?: string,
  prompt?: string,
  username?: string,
): DiscordEmbed {
  const prUrl = run.git?.branches.find((branch) => branch.prUrl)?.prUrl;
  const branch = run.git?.branches.find((item) => item.branch)?.branch;

  // Repo/cloud agents expose an agent URL and git info worth surfacing. Chat
  // models don't, so we keep their card focused on the answer + which model.
  const isRepoAgent = Boolean(agentUrl) || Boolean(run.git);
  const fields: DiscordEmbed["fields"] = isRepoAgent
    ? [
        {
          name: "Agent ID",
          value: agentUrl ? `[${run.agentId}](${agentUrl})` : `\`${run.agentId}\``,
          inline: true,
        },
        { name: "Run ID", value: `\`${run.id}\``, inline: true },
        { name: "Provider", value: providerDisplayName, inline: true },
      ]
    : [{ name: "Model", value: providerDisplayName, inline: true }];
  if (branch) fields.push({ name: "Branch", value: `\`${branch}\`` });
  if (prUrl) fields.push({ name: "Pull request", value: prUrl });

  // Discord renders description above fields — put the user's prompt first,
  // then the bot answer, so the original question is always at the top.
  const descriptionParts: string[] = [];
  if (prompt) {
    const who = username
      ? `**${truncate(username, 80)} asked**`
      : "**Prompt**";
    descriptionParts.push(`${who}\n${truncate(prompt, 1000)}`);
  }
  if (run.result) {
    descriptionParts.push(truncate(run.result, prompt ? 2800 : 3900));
  }

  const embed: DiscordEmbed = {
    color: statusColors[run.status],
    title: `${statusLabels[run.status]} · ${project.displayName ?? project.name}`,
    fields,
    timestamp: new Date(run.updatedAt).toISOString(),
  };
  if (descriptionParts.length > 0) {
    embed.description = truncate(descriptionParts.join("\n\n"), 4090);
  }
  return embed;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
