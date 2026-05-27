import { useState, useEffect } from 'react'
import { getToken } from './api'
import LoginView from './views/LoginView'
import PortalShell from './views/PortalShell'

const THEME_KEY   = 'gaaex-portal-theme'
const DENSITY_KEY = 'gaaex-portal-density'
const PALETTE_KEY = 'gaaex-portal-palette'

export type Theme   = 'dark' | 'light'
export type Density = 'default' | 'compact'

function seed(key: string, attr: string, fallback: string) {
  const val = localStorage.getItem(key) ?? fallback
  document.documentElement.setAttribute(attr, val)
  return val
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) ?? 'dark') as Theme)
  const [density] = useState<Density>(() => (localStorage.getItem(DENSITY_KEY) ?? 'default') as Density)

  // Seed attributes from localStorage on mount
  useEffect(() => {
    seed(THEME_KEY,   'data-theme',   'dark')
    seed(DENSITY_KEY, 'data-density', 'default')
    seed(PALETTE_KEY, 'data-palette', '')
  }, [])

  // Keep data-theme in sync whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // Keep data-density in sync
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
    localStorage.setItem(DENSITY_KEY, density)
  }, [density])

  function toggleTheme() {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }

  return authed
    ? <PortalShell onLogout={() => setAuthed(false)} theme={theme} onToggleTheme={toggleTheme} />
    : <LoginView onLogin={() => setAuthed(true)} />
}
