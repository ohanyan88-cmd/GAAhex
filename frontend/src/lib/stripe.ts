// Stripe.js loader — M1-C.1b. Returns a memoized Stripe promise (or null when the publishable
// key isn't configured, so the UI can render a "config missing" state instead of crashing).
//
// Publishable key source: Vite env var `VITE_STRIPE_PUBLISHABLE_KEY` (set in frontend/.env or
// .env.local at build time). Test mode keys start with `pk_test_`; live keys with `pk_live_`.
// No secret keys are ever loaded here — secrets live exclusively on the backend.
import { loadStripe, type Stripe } from '@stripe/stripe-js'

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined

/**
 * Memoized Stripe.js instance promise. `null` when no publishable key is configured —
 * downstream <Elements> usage MUST check for null and surface a clear config-missing
 * message rather than mounting the provider with a broken promise.
 */
export const stripePromise: Promise<Stripe | null> | null = publishableKey
  ? loadStripe(publishableKey)
  : null

/** True if a publishable key was injected at build time. */
export const isStripeConfigured = Boolean(publishableKey)
