import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Refuse to expose controls in a framed page. HTTP frame-ancestors is still
// required for a complete framing policy on a host that supports custom headers.
if (window.top !== window.self) {
  document.getElementById('root').textContent = 'Open Gym Tracker directly to continue.'
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  // Register the service worker, so a repeat launch is instant and the app works
  // with no signal.
  //
  // Only in a production build: during development the worker would cache the
  // modules being edited and serve them back, which is a confusing way to lose an
  // afternoon.
  //
  // The scope is the base path, which is where the app is served from. The worker
  // file sits at the root of that path, so it cannot control anything above it.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
        .catch(() => {
          // A failed registration costs the offline cache and nothing else. The app
          // works exactly as it did before, just without the offline shell.
        })
    })
  }
}
