import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue("admin-user-id") }));
vi.mock("@/lib/clerk-invitations", () => ({ createClerkInvitation: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    waitlistEntry: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { sendBatchInvitations } from "../invitations";
import { createClerkInvitation } from "@/lib/clerk-invitations";
import { sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

const mockCreate = vi.mocked(createClerkInvitation);
const mockSend = vi.mocked(sendEmail);
const mockFindMany = vi.mocked(prisma.waitlistEntry.findMany);
const mockUpdate = vi.mocked(prisma.waitlistEntry.update);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.postimi.com";
});

describe("sendBatchInvitations", () => {
  it("sends invitations to un-invited entries and updates DB", async () => {
    mockFindMany.mockResolvedValue([
      { id: "w1", email: "a@x.com", locale: "en", invitedAt: null },
    ] as never);
    mockCreate.mockResolvedValue({
      id: "inv_1",
      emailAddress: "a@x.com",
      url: "https://app.postimi.com/sign-up?ticket=xxx",
      status: "pending",
    });
    mockSend.mockResolvedValue({ id: "msg_1" });
    mockUpdate.mockResolvedValue({} as never);

    const result = await sendBatchInvitations(["w1"]);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockCreate).toHaveBeenCalledWith("a@x.com", "https://app.postimi.com/sign-up");
    expect(mockSend).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: expect.objectContaining({ invitationId: "inv_1" }),
    });
  });

  it("skips already-invited entries without creating new invitation", async () => {
    mockFindMany.mockResolvedValue([
      { id: "w1", email: "a@x.com", locale: "en", invitedAt: new Date() },
    ] as never);

    const result = await sendBatchInvitations(["w1"]);

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("isolates failures — one bad entry does not kill the batch", async () => {
    mockFindMany.mockResolvedValue([
      { id: "w1", email: "a@x.com", locale: "en", invitedAt: null },
      { id: "w2", email: "b@x.com", locale: "en", invitedAt: null },
    ] as never);
    mockCreate.mockResolvedValueOnce({
      id: "inv_1",
      emailAddress: "a@x.com",
      url: "https://app.postimi.com/sign-up?t=1",
      status: "pending",
    });
    mockCreate.mockRejectedValueOnce(new Error("Clerk down"));
    mockSend.mockResolvedValue({ id: "msg_1" });
    mockUpdate.mockResolvedValue({} as never);

    const result = await sendBatchInvitations(["w1", "w2"]);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    const failed = result.results.find((r) => r.status === "failed");
    expect(failed && "error" in failed && failed.error).toContain("Clerk down");
  });
});
