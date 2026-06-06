// ErrorBoundary — catches render-time errors from descendants and shows a
// recoverable fallback card instead of letting the whole app crash.
//
// Why a class component: React's error-catching lifecycle (getDerivedStateFromError /
// componentDidCatch) is only available on classes — hooks cannot intercept
// render errors.
//
// Props:
//   - children: the tree to guard (required).
//   - fallback: optional custom UI rendered in place of the default card.
//               Can be a ReactNode or a render fn `(error, reset) => ReactNode`
//               for sections that want to wire their own reset semantics.
//   - onReset:  optional callback fired after the boundary clears its error
//               state. Use it to re-fetch data so "Try again" actually retries.
//
// Logging: errors are logged to console via `[ErrorBoundary]` — no external
// reporter is wired (out of scope for this pass).
import { Component, type ReactNode } from 'react'
import { ErrorBanner } from './States'

type FallbackRender = (error: Error, reset: () => void) => ReactNode

interface Props {
  children: ReactNode
  fallback?: ReactNode | FallbackRender
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: unknown): State {
    const err =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'An unexpected error occurred.')
    return { hasError: true, error: err }
  }

  componentDidCatch(error: unknown, errorInfo: { componentStack: string }) {
    // Dev-time visibility; a real shipping app would forward to an error tracker.
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error ?? new Error('An unexpected error occurred.')

      // Caller-provided fallback wins — supports either a static node or a
      // render fn that gets the error + reset handle.
      if (this.props.fallback !== undefined) {
        if (typeof this.props.fallback === 'function') {
          return (this.props.fallback as FallbackRender)(err, this.reset)
        }
        return this.props.fallback
      }

      // Default: themed card with the project's existing ErrorBanner + a
      // "Try again" button. Wrapped in a state card so it sits cleanly inside
      // any container the boundary is dropped into.
      return (
        <div className="empty-state" role="alert" style={{ alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-5)' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Something went wrong</h3>
            <p style={{ margin: 0, fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>
              {err.message || 'An unexpected error occurred while rendering this section.'}
            </p>
            <ErrorBanner
              message="The error has been logged to the browser console."
              onRetry={this.reset}
            />
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
