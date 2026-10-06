import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Refuse to expose controls in a framed page. HTTP frame-ancestors is still
// required for a complete framing policy on a host that supports custom headers.
if (window.top !== window.self) {
  document.getElementById('root').textContent = 'Open Gym Tracker directly to continue.'
} else createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
