import type { Platform } from "@/lib/types";
import type { PlatformImporter, PlatformTokenClient } from "./types";

export interface PlatformEntry<P extends Platform = Platform> {
  token: PlatformTokenClient<P>;
  /** Optional — LinkedIn has no importer (CSV-only, see ADR-008). */
  importer?: PlatformImporter<P>;
}

// Mutable internal map. Exported lookup helpers below are read-only.
const REGISTRY = new Map<Platform, PlatformEntry>();

/**
 * Register (or replace) a platform's integration. Called once per platform
 * from the token module's top-level code so the registry is populated as
 * soon as the module is imported.
 */
export function registerPlatform<P extends Platform>(entry: PlatformEntry<P>): void {
  // Widening from `PlatformEntry<P>` to `PlatformEntry<Platform>` is safe
  // because the map keys by the concrete `entry.token.platform` tag — a
  // consumer always narrows back via `getPlatform(P)`. TypeScript cannot
  // prove this by variance, hence the double cast through `unknown`.
  REGISTRY.set(entry.token.platform, entry as unknown as PlatformEntry);
}

/**
 * Look up a platform by enum value. Returns `undefined` if the platform
 * module has not been imported — callers must handle missing entries
 * (e.g. skip with a warning in cron, 404 in UI routes).
 */
export function getPlatform<P extends Platform>(platform: P): PlatformEntry<P> | undefined {
  return REGISTRY.get(platform) as PlatformEntry<P> | undefined;
}

/**
 * Return all registered platforms. Order is insertion order, which matches
 * the import order of the registering modules — use `PLATFORMS` from
 * `@/lib/types` if you need a stable canonical order.
 */
export function listPlatforms(): ReadonlyArray<PlatformEntry> {
  return Array.from(REGISTRY.values());
}

/**
 * Return only platforms that support API-based ingestion (have an
 * importer). The Strategist's future `social-import` cron iterates this.
 */
export function listImportablePlatforms(): ReadonlyArray<PlatformEntry> {
  return Array.from(REGISTRY.values()).filter((e) => e.importer !== undefined);
}
