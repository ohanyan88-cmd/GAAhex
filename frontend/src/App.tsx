import { useState } from 'react'
import { login, me, orgTree } from './api'

type Node = {
  id: string
  type: string
  name: string
  code: string | null
  path: string
  parent_id: string | null
}
type Me = { email: string; name: string; tenant_id: string }

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<Me | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [email, setEmail] = useState('admin@demo.isp')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const t = await login(email, password)
      setToken(t)
      setUser(await me(t))
      const tree = await orgTree()
      setNodes(tree.nodes)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function logout() {
    setToken(null)
    setUser(null)
    setNodes([])
  }

  if (!token) {
    return (
      <div className="center">
        <form className="card" onSubmit={handleLogin}>
          <h1>GAAex</h1>
          <p className="muted">Sign in</p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
          <button type="submit">Sign in</button>
          {error && <p className="err">{error}</p>}
          <p className="hint">demo: admin@demo.isp / admin123</p>
        </form>
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <strong>GAAex</strong>
        <span className="muted">{user?.name} · {user?.email}</span>
        <button onClick={logout}>Sign out</button>
      </header>
      <main>
        <h2>Org tree</h2>
        <ul className="tree">
          {nodes.map((n) => (
            <li key={n.id} style={{ marginLeft: (n.path.split('.').length - 1) * 22 }}>
              <span className="badge">{n.type}</span>
              {n.name} <span className="muted">/{n.path}/</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
