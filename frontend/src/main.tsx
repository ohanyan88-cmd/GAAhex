import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastHost } from './components/Toast'
import { ConfirmHost } from './components/Modal'
import { BootSplash } from './components/BootSplash'
import 'leaflet/dist/leaflet.css'
// D19 Path A (2026-06-05): color-tokens.css was deleted. gaahex-tokens.css is
// now the single source of truth for every `--gx-*` token. Enforced by the
// `D19 single token registry` HARD drift rule in tools/check_drift.py.
import './styles/gaahex-tokens.css'
import './styles/primitives.css'
import './styles/tailwind.css'
import './styles/styles.css'
import './styles/studio.css'
import './styles/_nms.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* SM-1 — AuthProvider owns token + user + capabilities + entities + orgNodes.
        Views consume it via useAuth(); no more prop-drilling. */}
    <AuthProvider>
      <App />
    </AuthProvider>
    {/* Overlay-family singletons — portal to <body>, so they work app-wide (incl. logged-out). */}
    <ToastHost />
    <ConfirmHost />
    {/* Branded load moment — animated mark, plays once per page load then fades out. */}
    <BootSplash />
  </React.StrictMode>,
)
