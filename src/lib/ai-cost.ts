const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-6": { in: 15.0, out: 75.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4.0 },
};

const FALLBACK_PRICING = PRICING["claude-opus-4-6"];

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] ?? FALLBACK_PRICING;
  if (!PRICING[model]) {
    console.warn(`[ai-cost] unknown model: ${model}, using opus pricing as fallback`);
  }
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
