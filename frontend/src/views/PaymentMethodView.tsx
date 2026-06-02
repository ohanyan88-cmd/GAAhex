// PaymentMethodView — M1-C.1b. Stripe Elements-based card capture flow (PCI-minimized).
//
// Why this exists: M1-C.1a backend ships two endpoints —
//   POST /api/payment-methods/setup-intent  → { clientSecret }
//   POST /api/payment-methods               → confirms + stores PaymentMethod row
// This view is the customer-facing capture surface. Raw card details NEVER touch our backend
// (Stripe Elements iframes the card inputs and exchanges them for a `pm_xxx` id via
// stripe.confirmCardSetup), so we stay out of PCI scope beyond SAQ-A.
//
// Flow:
//   mount → POST /setup-intent → render <CardElement/> → user submits →
//   stripe.confirmCardSetup(clientSecret, { payment_method: { card } }) →
//   POST /api/payment-methods { stripePaymentMethodId } → success state.
//
// Errors handled distinctly:
//   - No publishable key configured (build-time .env miss)
//   - SetupIntent fetch failure (400/401/403/500/network)
//   - Stripe-side error from confirmCardSetup (card declined, invalid, etc.)
//   - Backend confirm failure (gateway-side weirdness, duplicate, etc.)
//
// Auth pattern: follows the rest of the views — `token: string` prop, used via the shared
// billing helpers (bget/bpost from lib/billing.ts). The bpost helper throws an Error with `.status`
// on non-2xx so we can branch on the message.
import { useEffect, useState } from 'react'
import { Elements, CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import type { StripeCardElementOptions } from '@stripe/stripe-js'
import { bpost } from '../lib/billing'
import { stripePromise, isStripeConfigured } from '../lib/stripe'

// ── Stripe Elements styling — matches our glass theme's input look. We deliberately keep this
// minimal: Stripe iframes its own field, so we only get to push fonts + colors into it. -------
const CARD_ELEMENT_OPTIONS: StripeCardElementOptions = {
  style: {
    base: {
      fontSize: '14px',
      color: 'var(--gx-text-1, #0f172a)',
      fontFamily: 'inherit',
      '::placeholder': { color: 'var(--gx-text-3, #94a3b8)' },
    },
    invalid: { color: 'var(--gx-danger-fg, #d63333)' },
  },
  hidePostalCode: true,
}

type SetupIntentResponse = { clientSecret: string }
type ConfirmResponse = { id?: string; gateway_token?: string; last4?: string; brand?: string }

// ── Outer wrapper: owns the <Elements> provider + the not-configured short-circuit ───────────
export default function PaymentMethodView({ token }: { token: string }) {
  if (!isStripeConfigured || !stripePromise) {
    return (
      <div className="card" style={{ padding: 24, maxWidth: 520, margin: '32px auto' }}>
        <h2 style={{ marginTop: 0 }}>Payment method capture unavailable</h2>
        <p style={{ color: 'var(--gx-text-2, #475569)', lineHeight: 1.5 }}>
          Stripe is not configured for this environment. Set{' '}
          <code className="mono">VITE_STRIPE_PUBLISHABLE_KEY</code> in the frontend build
          environment and reload.
        </p>
      </div>
    )
  }
  return (
    <Elements stripe={stripePromise}>
      <PaymentMethodForm token={token} />
    </Elements>
  )
}

// ── Inner form: needs to be inside <Elements> so the hooks resolve ───────────────────────────
function PaymentMethodForm({ token }: { token: string }) {
  const stripe = useStripe()
  const elements = useElements()

  // Phases of the flow — drives which UI block renders.
  type Phase = 'loading-intent' | 'ready' | 'confirming' | 'success' | 'error'
  const [phase, setPhase] = useState<Phase>('loading-intent')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [savedPaymentMethodId, setSavedPaymentMethodId] = useState<string | null>(null)

  // Step 1: fetch a SetupIntent client secret on mount. We retry-on-button via setPhase.
  useEffect(() => {
    let cancelled = false
    async function fetchIntent() {
      setPhase('loading-intent')
      setErrorMessage('')
      try {
        const data = await bpost<SetupIntentResponse>(token, '/api/payment-methods/setup-intent', {})
        if (cancelled) return
        if (!data?.clientSecret) {
          setErrorMessage('Setup intent response missing clientSecret')
          setPhase('error')
          return
        }
        setClientSecret(data.clientSecret)
        setPhase('ready')
      } catch (e) {
        if (cancelled) return
        setErrorMessage((e as Error).message || 'Failed to start card capture')
        setPhase('error')
      }
    }
    fetchIntent()
    return () => { cancelled = true }
  }, [token])

  // Step 2-5: user clicked Save → confirmCardSetup → backend confirm → success.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements || !clientSecret) return
    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      setErrorMessage('Card field not ready')
      setPhase('error')
      return
    }
    setPhase('confirming')
    setErrorMessage('')

    // Step 3: Stripe-side confirmation. PAN/CVC stay inside Stripe's iframe.
    const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card: cardElement },
    })
    if (stripeError) {
      setErrorMessage(stripeError.message || 'Card could not be saved')
      setPhase('error')
      return
    }
    const pmId = typeof setupIntent?.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent?.payment_method?.id
    if (!pmId) {
      setErrorMessage('Stripe did not return a payment method id')
      setPhase('error')
      return
    }

    // Step 5: hand the pm_xxx id to our backend to store the PaymentMethod row.
    try {
      const stored = await bpost<ConfirmResponse>(token, '/api/payment-methods', {
        stripePaymentMethodId: pmId,
      })
      // Backend serializer in M1-C.1a may return gateway_token (our DB id) and/or id;
      // we display whichever it provides, preferring its own id, falling back to the Stripe pm id.
      setSavedPaymentMethodId(stored?.id || stored?.gateway_token || pmId)
      setPhase('success')
    } catch (e) {
      setErrorMessage((e as Error).message || 'Backend rejected the payment method')
      setPhase('error')
    }
  }

  // Allow the user to recover after error without a full page reload — re-fetch a fresh
  // SetupIntent (the previous secret may have been consumed / become invalid).
  async function retry() {
    setErrorMessage('')
    setSavedPaymentMethodId(null)
    setClientSecret(null)
    try {
      setPhase('loading-intent')
      const data = await bpost<SetupIntentResponse>(token, '/api/payment-methods/setup-intent', {})
      if (!data?.clientSecret) {
        setErrorMessage('Setup intent response missing clientSecret')
        setPhase('error')
        return
      }
      setClientSecret(data.clientSecret)
      setPhase('ready')
    } catch (e) {
      setErrorMessage((e as Error).message || 'Failed to start card capture')
      setPhase('error')
    }
  }

  // ── Render branches ──────────────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="card" style={cardShellStyle}>
        <h2 style={{ marginTop: 0 }}>Card saved</h2>
        <p style={{ color: 'var(--gx-text-2, #475569)' }}>
          Your payment method has been stored securely.
        </p>
        {savedPaymentMethodId && (
          <p style={{ marginTop: 12 }}>
            <span style={{ color: 'var(--gx-text-3, #94a3b8)', fontSize: 12 }}>
              Payment method id
            </span>
            <br />
            <code className="mono" style={{ fontSize: 13 }}>{savedPaymentMethodId}</code>
          </p>
        )}
        <div style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-ghost btn-md" onClick={retry}>
            Add another card
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="card" style={cardShellStyle}>
      <h2 style={{ marginTop: 0 }}>Add payment method</h2>
      <p style={{ color: 'var(--gx-text-2, #475569)', marginBottom: 20, lineHeight: 1.5 }}>
        Your card details are sent directly to Stripe and never touch our servers.
      </p>

      {phase === 'loading-intent' && (
        <p className="muted">Preparing secure card form…</p>
      )}

      {(phase === 'ready' || phase === 'confirming' || phase === 'error') && clientSecret && (
        <>
          <label className="field" style={{ display: 'block' }}>
            <span>Card details</span>
            <div
              style={{
                padding: '12px 14px',
                border: '1px solid var(--gx-border, #e2e8f0)',
                borderRadius: 6,
                background: 'var(--gx-surface-1, #fff)',
              }}
            >
              <CardElement options={CARD_ELEMENT_OPTIONS} />
            </div>
          </label>

          <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              type="submit"
              className="btn btn-primary btn-md"
              disabled={!stripe || !elements || phase === 'confirming'}
            >
              {phase === 'confirming' ? 'Saving…' : 'Save card'}
            </button>
          </div>
        </>
      )}

      {phase === 'error' && !clientSecret && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-ghost btn-md" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {errorMessage && (
        <p
          role="alert"
          style={{
            marginTop: 16,
            padding: '10px 12px',
            background: 'rgba(214,51,51,0.08)',
            color: 'var(--gx-danger-fg, #d63333)',
            border: '1px solid rgba(214,51,51,0.25)',
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {errorMessage}
        </p>
      )}
    </form>
  )
}

const cardShellStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 520,
  margin: '32px auto',
}
