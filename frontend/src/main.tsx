import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import { ProjectsProvider } from './lib/projects-context'
import { SecretsProvider } from './lib/secrets-context'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ProjectsProvider>
        <SecretsProvider>
          <App />
        </SecretsProvider>
      </ProjectsProvider>
    </AuthProvider>
  </StrictMode>,
)
