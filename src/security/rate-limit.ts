import type { DataStore } from "../db/types.js";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * Per-user, per-hour limit on *new* agent starts. Follow-ups are unlimited.
 * The count-and-record step is atomic in PostgreSQL so the limit holds across
 * the many concurrent, stateless Worker invocations of one hosted app.
 */
export class StartRateLimiter {
  constructor(
    private readonly store: DataStore,
    private readonly startsPerHour: number,
  ) {}

  async tryConsume(
    orgId: string,
    userId: string,
    guildId: string,
    projectName: string,
  ): Promise<RateLimitResult> {
    const allowed = await this.store.tryRecordStart(
      orgId,
      userId,
      guildId,
      projectName,
      60 * 60 * 1000,
      this.startsPerHour,
    );
    if (!allowed) {
      return {
        allowed: false,
        message: `You have reached the limit of ${this.startsPerHour} new agents per hour. Follow-ups with /agent are still allowed.`,
      };
    }
    return { allowed: true };
  }
}
