import Stripe from "stripe";

let _stripe: Stripe | null = null;

/**
 * Lazily initialized Stripe client. Throws at call-time (not import-time)
 * if STRIPE_SECRET_KEY is missing — prevents build/test crashes in envs
 * that don't need Stripe.
 */
function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { typescript: true });
  }
  return _stripe;
}

/**
 * Proxy that lazily initializes the Stripe client on first property access.
 * Import and use like a normal Stripe instance: `stripe.checkout.sessions.create(...)`.
 */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const real = getStripe();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";
