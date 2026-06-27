import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import TaskboardV2 from './TaskboardV2'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
const path = typeof window !== 'undefined' ? (window.location && window.location.pathname) || '/' : '/'
if (path && path.startsWith('/taskboard-v2')) {
  root.render(<TaskboardV2 />)
} else {
  root.render(<App />)
}

// Register service worker for Taskboard V2 when available (safe, opt-in)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    if (path && path.startsWith('/taskboard-v2')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/taskboard-v2/sw.js', { scope: '/taskboard-v2/' })
          .then(() => console.log('Taskboard V2 service worker registered'))
          .catch((e) => console.warn('Service worker registration failed', e))
      })
    }
  } catch (e) {
    // ignore
  }
}
