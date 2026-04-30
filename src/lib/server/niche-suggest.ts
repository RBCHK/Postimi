import { generateObject, NoObjectGeneratedError } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { reserveQuota, completeReservation, failReservation } from "@/lib/ai-quota";
import { sanitizeNiche } from "@/lib/server/user-settings";

// Niche LLM-suggestion: read the user's most recent posts across all
// connected platforms, ask Sonnet 4.6 for a structured analysis, surface
// a primary niche + alternatives + drift warning when the content spans
// many unrelated themes.
//
// Defenses against prompt injection from user-imported posts:
//   1. The system prompt hard-restricts output shape to a Zod schema.
//   2. Every returned suggestion runs through `sanitizeNiche`, the same
//      validator that gates raw user input — strips control chars,
//      length-caps, blocks reserved tokens like "system:" / "ignore
//      previous" / tool-name echoes.
//   3. Quota gate (reserveQuota) blocks high-frequency abuse.

const POSTS_LIMIT = 50;
const MIN_TEXT_LEN = 30;
const MIN_USABLE_POSTS = 5;
const MAX_POST_PROMPT_CHARS = 300;

export const NICHE_SUGGEST_SCHEMA = z.object({
  primary: z
    .string()
    .min(3)
    .max(100)
    .describe(
      "Primary niche, 3-100 chars, concise English noun phrase (e.g. 'AI tools for solo creators', 'indie SaaS founder')."
    ),
  alternatives: z
    .array(z.string().min(3).max(100))
    .max(3)
    .describe("Up to 3 alternative niches in the same shape."),
  drift: z.object({
    detected: z
      .boolean()
      .describe(
        "True if the posts span more than ~3 unrelated themes (creator hasn't picked a focus)."
      ),
    themes: z
      .array(z.string().min(2).max(60))
      .max(6)
      .describe(
        "Up to 6 short labels for the themes detected. Empty array if `detected` is false."
      ),
  }),
});

export type NicheSuggestResult = z.infer<typeof NICHE_SUGGEST_SCHEMA>;

const SYSTEM_PROMPT = `You analyze social-media posts to identify the author's primary niche / topic focus.

Rules:
- "primary": one concise English noun phrase, 3-100 chars (e.g. "AI tools for solo creators", "indie SaaS founder", "fitness coaching for busy parents"). Avoid generic labels ("technology", "lifestyle"). Be specific to who the audience would be.
- "alternatives": up to 3 secondary niches in the same shape — distinct from primary.
- "drift": detect if the user posts across many unrelated themes (>3 distinct domains).
  - "detected": true if mixed; false if focused.
  - "themes": labels of detected themes when detected; empty array otherwise.

Do NOT include URLs, hashtags, @-mentions, emoji, or quoted text in suggestions.
Output ONLY the JSON object — no explanations, no markdown.`;

function buildPrompt(
  posts: { platform: string; text: string; likes: number; replies: number; reposts: number }[]
): string {
  const lines: string[] = [];
  lines.push(
    `Here are ${posts.length} most recent posts from the same author. Identify the niche.`
  );
  lines.push("");
  for (const p of posts) {
    const trimmed = p.text.replace(/\s+/g, " ").slice(0, MAX_POST_PROMPT_CHARS);
    lines.push(
      `[${p.platform}] (likes:${p.likes} replies:${p.replies} reposts:${p.reposts})\n${trimmed}`
    );
    lines.push("");
  }
  return lines.join("\n");
}

export class NotEnoughPostsError extends Error {
  constructor(
    public readonly usable: number,
    public readonly required: number = MIN_USABLE_POSTS
  ) {
    super(`Need ${required}+ posts with text to suggest a niche; have ${usable}.`);
    this.name = "NotEnoughPostsError";
  }
}

export async function suggestNicheForUser(userId: string): Promise<NicheSuggestResult> {
  const posts = await prisma.socialPost.findMany({
    where: { userId },
    orderBy: { postedAt: "desc" },
    take: POSTS_LIMIT,
    select: {
      platform: true,
      text: true,
      postedAt: true,
      likes: true,
      replies: true,
      reposts: true,
    },
  });
  const usable = posts.filter((p) => p.text.length >= MIN_TEXT_LEN);
  if (usable.length < MIN_USABLE_POSTS) {
    throw new NotEnoughPostsError(usable.length);
  }

  const reservation = await reserveQuota({ userId, operation: "niche_suggest" });
  let completed = false;
  try {
    const model = "claude-sonnet-4-6";
    let raw: NicheSuggestResult;
    try {
      const result = await generateObject({
        model: anthropic(model),
        maxOutputTokens: 1000,
        schema: NICHE_SUGGEST_SCHEMA,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(usable),
      });
      await completeReservation({
        reservationId: reservation.reservationId,
        model,
        tokensIn: result.usage.inputTokens ?? 0,
        tokensOut: result.usage.outputTokens ?? 0,
      });
      completed = true;
      raw = result.object;
    } catch (err) {
      if (err instanceof NoObjectGeneratedError) {
        Sentry.captureMessage("niche-suggest schema-fit failed", {
          level: "warning",
          tags: { area: "niche-suggest", userId, model },
        });
        if (!completed) {
          await completeReservation({
            reservationId: reservation.reservationId,
            model,
            tokensIn: err.usage?.inputTokens ?? 0,
            tokensOut: err.usage?.outputTokens ?? 0,
          });
          completed = true;
        }
        throw new Error("Model could not produce a structured suggestion. Try again later.");
      }
      throw err;
    }

    // Sanitize each suggestion. If the model slipped a prompt-injection
    // payload from a post, sanitizeNiche throws and we drop the entry.
    // The primary niche must survive — alternatives can be dropped.
    const safe = (s: string): string | null => {
      try {
        return sanitizeNiche(s);
      } catch {
        return null;
      }
    };

    const primary = safe(raw.primary);
    if (!primary) {
      throw new Error("Suggested niche could not be sanitized — try again.");
    }
    const alternatives = raw.alternatives
      .map(safe)
      .filter((s): s is string => !!s)
      .filter((s) => s !== primary)
      .slice(0, 3);
    const driftThemes = raw.drift.themes
      .map((t) => t.replace(/[\x00-\x1F\x7F]/g, " ").trim())
      .filter((t) => t.length > 0)
      .slice(0, 6);

    return {
      primary,
      alternatives,
      drift: {
        detected: raw.drift.detected,
        themes: raw.drift.detected ? driftThemes : [],
      },
    };
  } catch (err) {
    if (!completed) {
      await failReservation(reservation.reservationId);
    }
    throw err;
  }
}
