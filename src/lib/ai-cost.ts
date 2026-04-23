import * as Sentry from "@sentry/nextjs";

const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-6": { in: 15.0, out: 75.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4.0 },
};

const FALLBACK_PRICING = PRICING["claude-opus-4-6"];

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] ?? FALLBACK_PRICING;
  if (!PRICING[model]) {
    // Billing is on the critical path: an unknown model falling back to
    // opus pricing may over-charge the user (or under-charge if opus is
    // actually cheaper than the real model). Surface in Sentry so we add
    // the new model's real price before it hits production traffic.
    Sentry.captureMessage(`[ai-cost] unknown model: ${model}, using opus pricing as fallback`, {
      level: "warning",
      tags: { area: "ai-cost", model },
    });
    console.warn(`[ai-cost] unknown model: ${model}, using opus pricing as fallback`);
  }
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
