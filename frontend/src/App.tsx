import { useEffect, useState } from 'react'
import { login, me, getEntities, orgTree } from './api'
import EntityView from './EntityView'
import StudioView from './StudioView'
import ReportsView from './ReportsView'
import DashboardView from './DashboardView'
import NotificationCenter from './NotificationCenter'
import { GearIcon, SunIcon, MoonIcon } from './icons'

type Me = { email: string; name: string; tenant_id: string; can_configure?: boolean }
type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type OrgNode = { id: string; type: string; name: string; path: string }
type View = { type: 'org' } | { type: 'entity'; slug: string } | { type: 'studio' } | { type: 'reports' } | { type: 'dashboards' }

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<Me | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [orgNodes, setOrgNodes] = useState<OrgNode[]>([])
  const [view, setView] = useState<View>({ type: 'org' })

  const [email, setEmail] = useState('admin@demo.isp')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')

  // Theme: dark is the default (:root); light is the [data-theme="light"] override. Persisted.
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('gaaex-theme') === 'light' ? 'light' : 'dark'),
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('gaaex-theme', theme)
  }, [theme])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const t = await login(email, password)
      setToken(t)
      setUser(await me(t))
      setEntities(await getEntities(t))
      setOrgNodes((await orgTree()).nodes)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function logout() {
    setToken(null); setUser(null); setEntities([]); setView({ type: 'org' })
  }

  if (!token) {
    return (
      <div className="center">
        <form className="card" onSubmit={handleLogin}>
          <img src="/full-dark.png" alt="GAAex" className="logo-lg" />
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
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><img src="/icon-light.png" alt="GAAex" className="logo-sm" /></div>
        <div className="nav-label">Workspace</div>
        <button className={'nav' + (view.type === 'org' ? ' on' : '')} onClick={() => setView({ type: 'org' })}>Org tree</button>
        <button className={'nav' + (view.type === 'dashboards' ? ' on' : '')} onClick={() => setView({ type: 'dashboards' })}>Dashboards</button>
        <button className={'nav' + (view.type === 'reports' ? ' on' : '')} onClick={() => setView({ type: 'reports' })}>Reports</button>
        <div className="nav-label">Records</div>
        {entities.map((en) => (
          <button
            key={en.key}
            className={'nav' + (view.type === 'entity' && view.slug === en.route_slug ? ' on' : '')}
            onClick={() => setView({ type: 'entity', slug: en.route_slug })}
          >
            {en.label_plural}
          </button>
        ))}
        {user?.can_configure && (
          <>
            <div className="nav-label">Admin</div>
            <button className={'nav nav-icon' + (view.type === 'studio' ? ' on' : '')} onClick={() => setView({ type: 'studio' })}><GearIcon /> Studio</button>
          </>
        )}
      </aside>

      <div className="content">
        <header>
          <span className="muted">{user?.name} · {user?.email}</span>
          <div className="header-right">
            <button
              className="iconbtn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
            <NotificationCenter
              token={token}
              entities={entities}
              onOpen={(slug) => setView({ type: 'entity', slug })}
            />
            <button onClick={logout}>Sign out</button>
          </div>
        </header>
        <main>
          {view.type === 'org'
            ? <OrgTreeView nodes={orgNodes} />
            : view.type === 'dashboards'
              ? <DashboardView token={token} />
              : view.type === 'reports'
                ? <ReportsView token={token} />
                : view.type === 'studio'
                  ? <StudioView token={token} onCreated={async () => setEntities(await getEntities(token))} />
                  : <EntityView token={token} slug={view.slug} />}
        </main>
      </div>
    </div>
  )
}

function OrgTreeView({ nodes }: { nodes: OrgNode[] }) {
  return (
    <div>
      <h2>Org tree</h2>
      <ul className="tree">
        {nodes.map((n) => (
          <li key={n.id} style={{ marginLeft: (n.path.split('.').length - 1) * 22 }}>
            <span className="badge">{n.type}</span>{n.name} <span className="muted">/{n.path}/</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
