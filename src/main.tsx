import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ErrorProvider } from './contexts/ErrorProvider'
import { AuthProvider } from './contexts/AuthProvider'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorProvider>
  </StrictMode>,
)
