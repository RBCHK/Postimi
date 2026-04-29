import type { Platform } from "@/lib/types";
import type { PlatformPublisher } from "./types";
import { xPublisher } from "./x-publisher";
import { linkedinPublisher } from "./linkedin-publisher";
import { threadsPublisher } from "./threads-publisher";

// Module-level registry mapped from Platform enum to publisher singleton.
// Publishers are stateless adapters — one instance per platform serves
// every concurrent publish call without contention.

const PUBLISHERS: Record<Platform, PlatformPublisher> = {
  X: xPublisher as PlatformPublisher,
  LINKEDIN: linkedinPublisher as PlatformPublisher,
  THREADS: threadsPublisher as PlatformPublisher,
};

export function getPublisher<P extends Platform>(platform: P): PlatformPublisher<P> {
  // Cast through unknown — the registry is keyed by Platform but each
  // publisher singleton's typed `<P>` doesn't unify with the lookup
  // expression. Safe because PUBLISHERS is exhaustive over Platform
  // and the runtime value is exactly PlatformPublisher<P>.
  return PUBLISHERS[platform] as unknown as PlatformPublisher<P>;
}

export type { PlatformPublisher, PublishArgs, PublishResult } from "./types";
export { xPublisher, linkedinPublisher, threadsPublisher };
