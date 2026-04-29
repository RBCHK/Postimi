import { describe, it, expect } from "vitest";
import { toRenderableCards } from "../insight-feed";
import type { DailyInsightCards } from "@/lib/types";

// 2026-04 refactor: InsightFeed accepts BOTH the new structured shape
// and the legacy `string[]` shape (pre-refactor rows still in the DB).
// Discriminator-free dispatch via Array.isArray. The interesting
// behaviour lives in `toRenderableCards()` — render-layer concerns
// (DOM, accessibility) are intentionally not unit-tested here; we cover
// them via Playwright on the home page.

describe("toRenderableCards", () => {
  describe("legacy string[] shape", () => {
    it("renders each entry as a tactical card with no platform tag", () => {
      const out = toRenderableCards([
        "Старая инсайт первая.",
        "Старая инсайт вторая.",
        "Старая инсайт третья.",
      ]);
      expect(out).toHaveLength(3);
      for (const card of out) {
        expect(card.type).toBe("tactical");
        expect(card.platform).toBeUndefined();
      }
      expect(out.map((c) => c.text)).toEqual([
        "Старая инсайт первая.",
        "Старая инсайт вторая.",
        "Старая инсайт третья.",
      ]);
    });

    it("filters empty strings", () => {
      const out = toRenderableCards(["valid", "", "also valid"]);
      expect(out).toHaveLength(2);
      expect(out.map((c) => c.text)).toEqual(["valid", "also valid"]);
    });

    it("returns empty array when payload is []", () => {
      expect(toRenderableCards([])).toEqual([]);
    });
  });

  describe("new DailyInsightCards shape", () => {
    it("emits headline + tactical[] + opportunity + warning + encouragement in stable order", () => {
      const cards: DailyInsightCards = {
        headline: "Главное на сегодня.",
        tactical: [
          { platform: "X", text: "Тактика для X." },
          { platform: "LINKEDIN", text: "Тактика для LinkedIn." },
        ],
        opportunity: { platform: "THREADS", text: "Тренд на Threads." },
        warning: { platform: "X", text: "Падает engagement." },
        encouragement: "Держись.",
      };
      const out = toRenderableCards(cards);

      expect(out.map((c) => c.type)).toEqual([
        "headline",
        "tactical",
        "tactical",
        "opportunity",
        "warning",
        "encouragement",
      ]);
      expect(out[0]).toMatchObject({ type: "headline", text: "Главное на сегодня." });
      // Headline carries no platform tag.
      expect(out[0]?.platform).toBeUndefined();
      // Tactical cards keep their platform tags.
      expect(out[1]).toMatchObject({ type: "tactical", text: "Тактика для X.", platform: "X" });
      expect(out[2]).toMatchObject({
        type: "tactical",
        text: "Тактика для LinkedIn.",
        platform: "LINKEDIN",
      });
      expect(out[3]).toMatchObject({
        type: "opportunity",
        text: "Тренд на Threads.",
        platform: "THREADS",
      });
      expect(out[4]).toMatchObject({
        type: "warning",
        text: "Падает engagement.",
        platform: "X",
      });
      // Encouragement carries no platform tag.
      expect(out[5]).toMatchObject({ type: "encouragement", text: "Держись." });
      expect(out[5]?.platform).toBeUndefined();
    });

    it("handles a quiet day (just headline, everything else null/empty)", () => {
      const cards: DailyInsightCards = {
        headline: "Сегодня тихо, держи курс.",
        tactical: [],
        opportunity: null,
        warning: null,
        encouragement: null,
      };
      const out = toRenderableCards(cards);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: "headline", text: "Сегодня тихо, держи курс." });
    });

    it("omits encouragement when string is empty", () => {
      const cards: DailyInsightCards = {
        headline: "x",
        tactical: [],
        opportunity: null,
        warning: null,
        // Treat "" the same as null — the model shouldn't emit empty
        // strings, but if it does we don't want a blank card.
        encouragement: "",
      };
      const out = toRenderableCards(cards);
      expect(out.map((c) => c.type)).toEqual(["headline"]);
    });

    it("renders all 3 tactical cards when model uses the full quota", () => {
      const cards: DailyInsightCards = {
        headline: "h",
        tactical: [
          { platform: "X", text: "t1" },
          { platform: "LINKEDIN", text: "t2" },
          { platform: "THREADS", text: "t3" },
        ],
        opportunity: null,
        warning: null,
        encouragement: null,
      };
      const out = toRenderableCards(cards);
      expect(out.filter((c) => c.type === "tactical")).toHaveLength(3);
    });
  });
});
