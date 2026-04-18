import { describe, it, expect, vi, beforeEach } from "vitest";

// ADR-008 Phase 3 server-action tests.
//
// These cover the action-level guards that are *not* enforced by the
// parser itself: size cap, MIME/encoding sniffing, duplicate upsert,
// authenticated user isolation.

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// `vi.mock` is hoisted above top-level consts; use `vi.hoisted` so the
// mock module references the same object we later drive from tests.
const prismaMock = vi.hoisted(() => ({
  socialPost: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  socialFollowersSnapshot: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { requireUserId } from "@/lib/auth";
import { importLinkedInCsv } from "../linkedin-csv";

const USER_ID = "user-li-1";

const CONTENT_HEADERS =
  "Post URL,Post title,Post publish date,Post type,Impressions,Reactions,Comments,Reposts,Clicks";

function contentCsv(rows: string[]): string {
  return `${CONTENT_HEADERS}\n${rows.join("\n")}`;
}

function formDataWith(file: File): FormData {
  const fd = new FormData();
  fd.set("file", file);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  prismaMock.socialPost.findUnique.mockResolvedValue(null);
  prismaMock.socialPost.upsert.mockResolvedValue({ id: "sp-1" });
  prismaMock.socialFollowersSnapshot.findUnique.mockResolvedValue(null);
  prismaMock.socialFollowersSnapshot.upsert.mockResolvedValue({});
});

describe("importLinkedInCsv — server action", () => {
  it("rejects files larger than the 5 MB cap", async () => {
    const blob = new Uint8Array(6 * 1024 * 1024);
    const file = new File([blob], "oversized.csv", { type: "text/csv" });
    await expect(importLinkedInCsv(formDataWith(file))).rejects.toThrow(/max 5 MB/);
  });

  it("accepts a well-formed UTF-8 content CSV and upserts into SocialPost with platform=LINKEDIN", async () => {
    const csv = contentCsv([
      "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/,hello,2026-04-10,Post,1000,50,5,2,20",
    ]);
    const file = new File([csv], "content.csv", { type: "text/csv" });

    const result = await importLinkedInCsv(formDataWith(file));
    expect(result.kind).toBe("content");
    expect(result.rowsParsed).toBe(1);
    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(1);
    const args = prismaMock.socialPost.upsert.mock.calls[0]![0];
    expect(args.where.userId_platform_externalPostId).toEqual({
      userId: USER_ID,
      platform: "LINKEDIN",
      externalPostId: "urn:li:activity:1234567890",
    });
    expect(args.create.dataSource).toBe("CSV");
    expect(args.create.platformMetadata.platform).toBe("LINKEDIN");
  });

  it("decodes UTF-16LE with BOM (LinkedIn's default export encoding)", async () => {
    const csv = contentCsv([
      "https://www.linkedin.com/feed/update/urn:li:activity:42/,hi,2026-04-10,Post,100,10,1,0,5",
    ]);
    // Encode CSV string as UTF-16LE with BOM
    const buffer = new Uint8Array(2 + csv.length * 2);
    buffer[0] = 0xff;
    buffer[1] = 0xfe;
    for (let i = 0; i < csv.length; i++) {
      buffer[2 + i * 2] = csv.charCodeAt(i) & 0xff;
      buffer[3 + i * 2] = (csv.charCodeAt(i) >> 8) & 0xff;
    }
    const file = new File([buffer], "content-utf16.csv", { type: "text/csv" });
    const result = await importLinkedInCsv(formDataWith(file));
    expect(result.rowsParsed).toBe(1);
    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(1);
  });

  it("treats a second import of the same row as update, not insert", async () => {
    const csv = contentCsv([
      "https://www.linkedin.com/feed/update/urn:li:activity:42/,hi,2026-04-10,Post,100,10,1,0,5",
    ]);
    const file = new File([csv], "content.csv", { type: "text/csv" });

    prismaMock.socialPost.findUnique.mockResolvedValueOnce({ id: "existing" });
    const result = await importLinkedInCsv(formDataWith(file));
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);
  });

  it("rejects malformed rows (URL not LinkedIn) with a user-facing error", async () => {
    const csv = contentCsv(["https://evil.com/foo,hi,2026-04-10,Post,100,10,1,0,5"]);
    const file = new File([csv], "content.csv", { type: "text/csv" });
    await expect(importLinkedInCsv(formDataWith(file))).rejects.toThrow(/LinkedIn URL/);
  });

  it("rejects when the file isn't a File (missing upload)", async () => {
    const fd = new FormData();
    await expect(importLinkedInCsv(fd)).rejects.toThrow(/No file uploaded/);
  });

  it("persists followers CSV into SocialFollowersSnapshot with computed deltas", async () => {
    const csv = [
      "Date,Total followers,Organic followers,Sponsored followers",
      "2026-04-10,1000,800,200",
      "2026-04-11,1010,810,200",
    ].join("\n");
    const file = new File([csv], "followers.csv", { type: "text/csv" });
    const result = await importLinkedInCsv(formDataWith(file));
    expect(result.kind).toBe("followers");
    expect(prismaMock.socialFollowersSnapshot.upsert).toHaveBeenCalledTimes(2);
    // Second call carries the 10-follower delta
    const secondCall = prismaMock.socialFollowersSnapshot.upsert.mock.calls[1]![0];
    expect(secondCall.create.deltaFollowers).toBe(10);
  });
});
