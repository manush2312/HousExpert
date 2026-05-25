import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Blur any focused number input on scroll so the wheel can't increment/decrement the value.
document.addEventListener('wheel', () => {
  const el = document.activeElement as HTMLInputElement | null
  if (el?.type === 'number') el.blur()
}, { passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
