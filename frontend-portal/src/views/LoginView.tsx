import { useState } from 'react'
import { api, setToken } from '../lib/api'

interface Props {
  onLogin: () => void
}

export default function LoginView({ onLogin }: Props) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await api.login(email, password)
      setToken(result.access_token)
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="center">
      <div className="card" style={{ width: 400 }}>
        {/* Logo */}
        <div className="logo-lg">GAAhex</div>
        <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, marginTop: -4, marginBottom: 4 }}>
          Customer Portal
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <span className="uppercase-label">Email</span>
            <input
              className="inp inp-md"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <span className="uppercase-label">Password</span>
            <input
              className="inp inp-md"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="error-banner">
              <span className="error-banner-msg">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-lg btn-block"
            style={{ marginTop: 4 }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
