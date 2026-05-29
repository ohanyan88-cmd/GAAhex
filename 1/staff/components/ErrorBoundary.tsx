import { Component, type ReactNode } from 'react'
import { ErrorBanner } from './States'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.'
    return { hasError: true, message }
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    // Log to console in dev; a real app would ship to an error tracker.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '32px 24px' }}>
          <ErrorBanner
            message={`Something went wrong — ${this.state.message}`}
            onRetry={this.reset}
          />
        </div>
      )
    }
    return this.props.children
  }
}
