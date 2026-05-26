import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastHost } from './Toast'
import { ConfirmHost } from './Modal'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* Overlay-family singletons — portal to <body>, so they work app-wide (incl. logged-out). */}
    <ToastHost />
    <ConfirmHost />
  </React.StrictMode>,
)
