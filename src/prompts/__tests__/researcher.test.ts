import { describe, it, expect } from "vitest";
import {
  getGlobalResearcherPrompt,
  buildGlobalResearcherUserMessage,
  getNicheResearcherPrompt,
  buildNicheResearcherUserMessage,
} from "../researcher";

// Anchor-string tests, NOT snapshot tests. We assert the prompt
// contains stable markers (platform display name, user's niche) so
// cosmetic copy-edits don't break the suite, but a regression that
// drops the platform/niche from the prompt does.

describe("getGlobalResearcherPrompt", () => {
  it("interpolates X display name and X-specific search topic", () => {
    const prompt = getGlobalResearcherPrompt("X");
    expect(prompt).toContain("X (Twitter)");
    expect(prompt).toContain("X Twitter algorithm changes");
  });

  it("interpolates LinkedIn display name and LinkedIn-specific search topic", () => {
    const prompt = getGlobalResearcherPrompt("LINKEDIN");
    expect(prompt).toContain("LinkedIn");
    expect(prompt).toContain("LinkedIn algorithm changes");
    // Sanity: doesn't accidentally drag X-specific copy into LinkedIn
    expect(prompt).not.toContain("X Twitter algorithm changes");
  });

  it("interpolates Threads display name and Threads-specific search topic", () => {
    const prompt = getGlobalResearcherPrompt("THREADS");
    expect(prompt).toContain("Threads");
    expect(prompt).toContain("Meta Threads algorithm");
  });

  it("instructs the model that delete tool is platform-scoped (defense-in-depth comment)", () => {
    const prompt = getGlobalResearcherPrompt("X");
    // The prompt must tell the model the delete tool only deletes notes
    // for THIS platform — paired with the closure binding in the route.
    expect(prompt).toMatch(/deletes only.+notes/i);
  });

  it("never contains undefined/null literal leaks", () => {
    for (const platform of ["X", "LINKEDIN", "THREADS"] as const) {
      const prompt = getGlobalResearcherPrompt(platform);
      expect(prompt).not.toMatch(/\bundefined\b/);
      expect(prompt).not.toMatch(/\bnull\b/);
    }
  });
});

describe("buildGlobalResearcherUserMessage", () => {
  it("lists platform name in the user message", () => {
    const msg = buildGlobalResearcherUserMessage("LINKEDIN", []);
    expect(msg).toContain("LinkedIn");
  });

  it("renders existing-notes list when notes are provided", () => {
    const msg = buildGlobalResearcherUserMessage("X", [
      { id: "note-1", topic: "first topic", createdAt: "2026-04-01" },
      { id: "note-2", topic: "second topic", createdAt: "2026-04-15" },
    ]);
    expect(msg).toContain("note-1");
    expect(msg).toContain("first topic");
    expect(msg).toContain("note-2");
    expect(msg).toContain("deleteOldGlobalNote");
  });

  it("handles empty existing-notes list cleanly (no delete instruction)", () => {
    const msg = buildGlobalResearcherUserMessage("X", []);
    expect(msg).toContain("No existing global research notes");
    expect(msg).not.toContain("deleteOldGlobalNote");
  });
});

describe("getNicheResearcherPrompt", () => {
  it("interpolates the niche string and connected platform names", () => {
    const prompt = getNicheResearcherPrompt(["X", "LINKEDIN"], "AI tools");
    expect(prompt).toContain("AI tools");
    expect(prompt).toContain("X (Twitter)");
    expect(prompt).toContain("LinkedIn");
  });

  it("includes anti-injection instruction (niche is topic, not instruction)", () => {
    const prompt = getNicheResearcherPrompt(["X"], "fitness");
    expect(prompt).toMatch(/topic.+not.+instruction/i);
  });

  it("instructs delete tool is user-scoped", () => {
    const prompt = getNicheResearcherPrompt(["X"], "ai");
    expect(prompt).toMatch(/deletes only this user/i);
  });

  it("never contains undefined/null literal leaks", () => {
    const prompt = getNicheResearcherPrompt(["X", "LINKEDIN", "THREADS"], "ai tools");
    expect(prompt).not.toMatch(/\bundefined\b/);
    expect(prompt).not.toMatch(/\bnull\b/);
  });
});

describe("buildNicheResearcherUserMessage", () => {
  it("includes niche, platforms, and existing-notes list", () => {
    const msg = buildNicheResearcherUserMessage(
      "AI tools",
      ["X", "THREADS"],
      [{ id: "n-1", topic: "previous research", createdAt: "2026-03-01" }]
    );
    expect(msg).toContain("AI tools");
    expect(msg).toContain("X (Twitter)");
    expect(msg).toContain("Threads");
    expect(msg).toContain("n-1");
    expect(msg).toContain("deleteOldUserNote");
  });

  it("handles empty existing-notes list cleanly", () => {
    const msg = buildNicheResearcherUserMessage("AI tools", ["X"], []);
    expect(msg).toContain("No existing niche research notes");
    expect(msg).not.toContain("deleteOldUserNote");
  });
});
