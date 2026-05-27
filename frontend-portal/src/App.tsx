import { useState } from 'react'
import { getToken } from './api'
import LoginView from './views/LoginView'
import PortalShell from './views/PortalShell'

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())

  return authed
    ? <PortalShell onLogout={() => setAuthed(false)} />
    : <LoginView onLogin={() => setAuthed(true)} />
}
