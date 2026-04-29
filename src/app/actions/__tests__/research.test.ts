import { describe, it, expect, vi, beforeEach } from "vitest";

// Research actions are thin wrappers over `@/lib/server/research`. The
// public Server Action surface is intentionally narrow (post-2026-04
// refactor): only `getAllUserResearchNotes` is exposed for the strategist
// page. Save/delete/mixed-read are cron-only and import from the lib
// directly — adding them here would make them callable RPC endpoints.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-research-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

const serverResearchMock = vi.hoisted(() => ({
  getAllUserResearchNotes: vi.fn(),
}));
vi.mock("@/lib/server/research", () => serverResearchMock);

import { requireUserId } from "@/lib/auth";
import { getAllUserResearchNotes } from "../research";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  serverResearchMock.getAllUserResearchNotes.mockResolvedValue([]);
});

describe("getAllUserResearchNotes", () => {
  it("authenticates and forwards userId — never accepts userId from caller", async () => {
    await getAllUserResearchNotes();
    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverResearchMock.getAllUserResearchNotes).toHaveBeenCalledWith(USER_ID);
    expect(serverResearchMock.getAllUserResearchNotes).toHaveBeenCalledTimes(1);
  });
});

describe("research action surface (regression — keep this narrow)", () => {
  it("does NOT export internal helpers as Server Actions", async () => {
    const mod = (await import("../research")) as Record<string, unknown>;
    // If a future change accidentally re-adds save/delete/mixed-read as
    // Server Actions, this test fails — forcing a deliberate decision.
    expect(mod).not.toHaveProperty("saveResearchNote");
    expect(mod).not.toHaveProperty("saveUserResearchNote");
    expect(mod).not.toHaveProperty("deleteResearchNote");
    expect(mod).not.toHaveProperty("deleteUserResearchNote");
    expect(mod).not.toHaveProperty("getRecentResearchNotes");
  });
});
