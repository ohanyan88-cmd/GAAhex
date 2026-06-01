import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastHost } from './components/Toast'
import { ConfirmHost } from './components/Modal'
import './styles/gaaex-tokens.css'
import './styles/primitives.css'
import './styles/tailwind.css'
import './styles/color-tokens.css'
import './styles/styles.css'
import './styles/studio.css'
import './layout/master-layout.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* Overlay-family singletons — portal to <body>, so they work app-wide (incl. logged-out). */}
    <ToastHost />
    <ConfirmHost />
  </React.StrictMode>,
)
