import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RouterProvider } from './lib/router'
import { AuthProvider } from './lib/auth'
import { SecretsProvider } from './lib/secrets-context'
import { Toaster } from './components/ui/sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <AuthProvider>
        <SecretsProvider>
          <App />
          <Toaster position="bottom-right" />
        </SecretsProvider>
      </AuthProvider>
    </RouterProvider>
  </StrictMode>,
)
