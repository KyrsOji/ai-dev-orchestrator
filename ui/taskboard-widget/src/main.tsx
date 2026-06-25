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
