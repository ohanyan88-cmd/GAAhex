import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastHost } from './components/Toast'
import { ConfirmHost } from './components/Modal'
import 'leaflet/dist/leaflet.css'
import './styles/gaahex-tokens.css'
import './styles/primitives.css'
import './styles/tailwind.css'
import './styles/color-tokens.css'
import './styles/styles.css'
import './styles/studio.css'
import './styles/nms-tokens.css'
import './layout/master-layout.css'

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
  </React.StrictMode>,
)
