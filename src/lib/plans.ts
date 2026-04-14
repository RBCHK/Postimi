export const PLANS = {
  pro: {
    stripePriceId: process.env.STRIPE_PRICE_ID ?? "",
    monthlyAiQuotaUsd: 10,
    maxOutputTokensPerRequest: 4000,
    rateLimitRequestsPerMinute: 30,
    name: "Postimi Pro",
  },
} as const;
