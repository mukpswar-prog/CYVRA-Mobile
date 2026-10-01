import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ActivationGate } from './activation/ActivationGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The wrapper around the frozen core: the application never renders
        unless the launch sequence says `enter`. */}
    <ActivationGate>
      <App />
    </ActivationGate>
  </StrictMode>,
)
