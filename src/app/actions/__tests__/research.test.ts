import { describe, it, expect, vi, beforeEach } from "vitest";

// Research actions are thin wrappers over `@/lib/server/research`. The
// public Server Action must authenticate first and forward userId to the
// helper — any bypass here leaks one user's research notes to another.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-research-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

const serverResearchMock = vi.hoisted(() => ({
  saveResearchNote: vi.fn(),
  getRecentResearchNotes: vi.fn(),
  getAllResearchNotes: vi.fn(),
  deleteResearchNote: vi.fn(),
}));
vi.mock("@/lib/server/research", () => serverResearchMock);

import { requireUserId } from "@/lib/auth";
import {
  saveResearchNote,
  getRecentResearchNotes,
  getAllResearchNotes,
  deleteResearchNote,
} from "../research";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  serverResearchMock.saveResearchNote.mockResolvedValue({
    id: "note-1",
    topic: "t",
    summary: "s",
    sources: [],
    queries: [],
    createdAt: new Date(),
  });
  serverResearchMock.getRecentResearchNotes.mockResolvedValue([]);
  serverResearchMock.getAllResearchNotes.mockResolvedValue([]);
  serverResearchMock.deleteResearchNote.mockResolvedValue(undefined);
});

describe("saveResearchNote", () => {
  it("authenticates and forwards (userId, data)", async () => {
    const data = {
      topic: "ai-scene",
      summary: "sum",
      sources: [{ url: "https://x", title: "t", snippet: null } as never],
      queries: ["q1"],
    };

    await saveResearchNote(data);

    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverResearchMock.saveResearchNote).toHaveBeenCalledWith(USER_ID, data);
  });
});

describe("getRecentResearchNotes", () => {
  it("defaults limit to 3 when omitted", async () => {
    await getRecentResearchNotes();
    expect(serverResearchMock.getRecentResearchNotes).toHaveBeenCalledWith(USER_ID, 3);
  });

  it("forwards an explicit limit", async () => {
    await getRecentResearchNotes(10);
    expect(serverResearchMock.getRecentResearchNotes).toHaveBeenCalledWith(USER_ID, 10);
  });
});

describe("getAllResearchNotes", () => {
  it("forwards userId", async () => {
    await getAllResearchNotes();
    expect(serverResearchMock.getAllResearchNotes).toHaveBeenCalledWith(USER_ID);
  });
});

describe("deleteResearchNote", () => {
  it("forwards (userId, id) — ownership enforced downstream", async () => {
    await deleteResearchNote("note-xyz");
    expect(serverResearchMock.deleteResearchNote).toHaveBeenCalledWith(USER_ID, "note-xyz");
  });
});
