// In-memory view of user_insights (LeaderboardStore pattern): warmed at boot,
// updated on every /insights POST. Holds merged per-user payloads so percentile
// scoring never hits the DB on a profile read.
import { mergeInsights, type MergedInsights } from "./insights.js";
import type { InsightsPayload } from "../db/schema.js";

export class InsightsStore {
  // userId → machineId → payload
  private byUser = new Map<string, Map<string, InsightsPayload>>();

  upsert(userId: string, machineId: string, payload: InsightsPayload): void {
    const machines = this.byUser.get(userId) ?? new Map<string, InsightsPayload>();
    machines.set(machineId, payload);
    this.byUser.set(userId, machines);
  }

  remove(userId: string): void {
    this.byUser.delete(userId);
  }

  merged(userId: string): MergedInsights | null {
    const machines = this.byUser.get(userId);
    if (!machines || machines.size === 0) return null;
    return mergeInsights([...machines.values()]);
  }

  machineCount(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /** Merged payloads for every consented user — the percentile population. */
  population(): MergedInsights[] {
    return [...this.byUser.keys()]
      .map((id) => this.merged(id))
      .filter((m): m is MergedInsights => m !== null);
  }

  size(): number {
    return this.byUser.size;
  }
}
