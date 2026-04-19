import { z } from "zod";
import type { Platform } from "@/lib/types";

// ─── Credentials ───────────────────────────────────────
//
// Each platform's credential type carries a distinct `platform` tag so the
// type system rejects cross-platform misuse (e.g. passing X creds to a
// Threads importer). The shared `accessToken` plus per-platform profile
// fields replace the three parallel `*ApiCredentials` types.

export interface XCredentials {
  platform: "X";
  accessToken: string;
  xUserId: string;
  xUsername: string;
}

export interface LinkedInCredentials {
  platform: "LINKEDIN";
  accessToken: string;
  linkedinUserId: string;
  linkedinName: string | null;
}

export interface ThreadsCredentials {
  platform: "THREADS";
  accessToken: string;
  threadsUserId: string;
  threadsUsername: string;
}

export type PlatformCredentials = XCredentials | LinkedInCredentials | ThreadsCredentials;

export type CredentialsFor<P extends Platform> = Extract<PlatformCredentials, { platform: P }>;

// ─── Token client interface ───────────────────────────
//
// A `PlatformTokenClient` owns the full lifecycle of OAuth credentials for
// a single platform: fetching (with auto-refresh if expired), saving after
// OAuth callback, and disconnecting. All three existing token modules
// implement this.

export interface PlatformTokenClient<P extends Platform = Platform> {
  readonly platform: P;
  /** Fetch valid credentials for the user, auto-refreshing if needed. Null = not connected. */
  getForUser(userId: string): Promise<CredentialsFor<P> | null>;
  /** Disconnect: delete the stored token. Idempotent. */
  disconnect(userId: string): Promise<void>;
}

// ─── Importer interface (Phase 2/3 contract) ─────────
//
// Platforms that support API-based ingestion (currently: X, Threads)
// implement `PlatformImporter`. LinkedIn does not — its analytics are
// CSV-only (see ADR-008) — so its registry slot has `importer: undefined`.
//
// The shapes below (`SocialPostInput`, `FollowersInput`) are the abstract
// contract between importers and whatever persistence layer Phase 1a
// builds. They intentionally do NOT reference Prisma types directly so the
// schema migration can land independently.

export interface SocialPostInput {
  platform: Platform;
  externalPostId: string;
  text: string;
  postedAt: Date;
  postUrl: string | null;
  metadata: PlatformMetadata;
  /** Per-post metrics at import time. May be updated later via engagement snapshots. */
  metrics: {
    impressions: number;
    likes: number;
    replies: number;
    reposts: number;
    shares: number;
    bookmarks: number;
  };
}

export interface FollowersInput {
  platform: Platform;
  date: Date;
  followersCount: number;
  followingCount: number | null;
}

export interface ImporterOptions {
  /** Only fetch posts newer than this date. */
  since?: Date;
  /** Max rows to return. Platforms may cap lower if rate limits require. */
  limit?: number;
}

export interface PlatformImporter<P extends Platform = Platform> {
  readonly platform: P;
  fetchPosts(creds: CredentialsFor<P>, opts?: ImporterOptions): AsyncIterable<SocialPostInput>;
  fetchFollowers(creds: CredentialsFor<P>): Promise<FollowersInput>;
}

// ─── Platform metadata (Zod-validated JSON) ───────────
//
// `SocialPost.platformMetadata` is a `Json` column in Postgres. Without a
// runtime validator it would be a `Record<string, unknown>` and require
// `as any` at every read site. The discriminated union below rejects
// X metadata stored under `platform: "THREADS"` and vice versa.

export const XPostMetadataSchema = z.object({
  platform: z.literal("X"),
  postType: z.enum(["POST", "REPLY", "QUOTE"]),
  /** Tweet ID of the post this is a reply to. */
  inReplyToId: z.string().nullable().optional(),
  /** Thread conversation root. */
  conversationId: z.string().nullable().optional(),
  /** Position within a thread (1 = head). */
  threadIndex: z.number().int().nonnegative().nullable().optional(),
  /** Media types attached: photo, video, animated_gif. */
  mediaTypes: z.array(z.enum(["photo", "video", "animated_gif"])).optional(),
});

export const LinkedInPostMetadataSchema = z.object({
  platform: z.literal("LINKEDIN"),
  postUrl: z.string().url(),
  postType: z.enum(["POST", "REPOST", "ARTICLE"]).optional(),
  /** Only present for ARTICLE. */
  articleUrl: z.string().url().nullable().optional(),
});

export const ThreadsPostMetadataSchema = z.object({
  platform: z.literal("THREADS"),
  mediaType: z.enum(["TEXT_POST", "IMAGE", "VIDEO", "CAROUSEL_ALBUM", "AUDIO", "REPOST_FACADE"]),
  /** Thread ID of the root if this is a reply. */
  replyToId: z.string().nullable().optional(),
  /** Permalink to the thread on threads.net. */
  permalink: z.string().url().nullable().optional(),
});

export const PlatformMetadataSchema = z.discriminatedUnion("platform", [
  XPostMetadataSchema,
  LinkedInPostMetadataSchema,
  ThreadsPostMetadataSchema,
]);

export type PlatformMetadata = z.infer<typeof PlatformMetadataSchema>;
export type XPostMetadata = z.infer<typeof XPostMetadataSchema>;
export type LinkedInPostMetadata = z.infer<typeof LinkedInPostMetadataSchema>;
export type ThreadsPostMetadata = z.infer<typeof ThreadsPostMetadataSchema>;

/**
 * Parse a `Json` value from Prisma into typed metadata. Throws on shape
 * mismatch — callers that expect unvalidated JSON should use `.safeParse`
 * directly. This is the single entry point for reading `platformMetadata`.
 */
export function parsePlatformMetadata(raw: unknown): PlatformMetadata {
  return PlatformMetadataSchema.parse(raw);
}
