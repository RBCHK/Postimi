import { describe, it, expect } from "vitest";
import { CRON_PATHS } from "../admin-view";

// Drift-guard: this UI map and the server-side `ALLOWED_CRON_PATHS`
// (in `@/app/actions/admin`) must stay in sync. If a job is in
// `ALLOWED_CRON_PATHS` but missing here, the admin UI silently hides
// "Run Now" for it (the symptom we hit pre-PR #4 with `auto-publish`).
// If a job is here but missing from the server whitelist, the Run Now
// button 404s.
//
// Source-of-truth list mirrors `prisma/seeds/cron-job-configs.ts` and
// the parallel test in `src/app/actions/__tests__/admin-run-cron-job.test.ts`
// — three places, one list. Update all three together.

const EXPECTED_JOBS = [
  "followers-snapshot",
  "trend-snapshot",
  "daily-insight",
  "social-import",
  "researcher",
  "strategist",
  "auto-publish",
] as const;

describe("admin-view CRON_PATHS map", () => {
  it("contains every job that has a CronJobConfig seed row", () => {
    for (const job of EXPECTED_JOBS) {
      expect(CRON_PATHS).toHaveProperty(job);
      expect(CRON_PATHS[job]).toBe(`/api/cron/${job}`);
    }
  });

  it("does not list any unexpected jobs (catches stale entries after a delete)", () => {
    const actual = Object.keys(CRON_PATHS).sort();
    const expected = [...EXPECTED_JOBS].sort();
    expect(actual).toEqual(expected);
  });

  it("auto-publish is reachable from the admin UI (regression for PR #4)", () => {
    // Pre-PR #4 this was missing — auto-publish was seeded and
    // server-allowlisted, but the UI never rendered a Run Now button
    // because this map didn't include it.
    expect(CRON_PATHS["auto-publish"]).toBe("/api/cron/auto-publish");
  });
});
