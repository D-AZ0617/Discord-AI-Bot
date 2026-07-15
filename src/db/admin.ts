import type {
  GuildInstallation,
  Organization,
  ProviderCredential,
  StoredProject,
} from "./types.js";

/**
 * Store operations used only by the onboarding dashboard / admin API. Kept
 * separate from the hot-path {@link DataStore} so the bot runtime stays lean.
 */
export interface AdminStore {
  createOrganization(name: string): Promise<Organization>;
  addMember(orgId: string, discordUserId: string, role: string): Promise<void>;
  isMember(orgId: string, discordUserId: string): Promise<boolean>;
  listOrgsForUser(discordUserId: string): Promise<Organization[]>;

  createInstallation(
    guildId: string,
    orgId: string,
    installedBy: string,
  ): Promise<void>;
  listInstallationsForOrg(orgId: string): Promise<GuildInstallation[]>;

  listProjects(orgId: string): Promise<StoredProject[]>;
  upsertProject(project: StoredProject): Promise<void>;
  deleteProject(orgId: string, name: string): Promise<void>;

  upsertCredential(credential: ProviderCredential): Promise<void>;
  listConfiguredProviderIds(orgId: string): Promise<string[]>;
}
