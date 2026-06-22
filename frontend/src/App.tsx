import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { Projects } from '@/pages/Projects';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { Admin } from '@/pages/Admin';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/projects';

type View = { name: 'projects' } | { name: 'project'; project: Project } | { name: 'admin' };

function App() {
  const { identity, isAuthenticated, loading, logout } = useAuth();
  const [view, setView] = useState<View>({ name: 'projects' });
  const [authView, setAuthView] = useState<'login' | 'signup'>(
    window.location.pathname === '/signup' ? 'signup' : 'login',
  );

  function showLogin() {
    window.history.pushState(null, '', '/');
    setAuthView('login');
  }

  function showSignup() {
    window.history.pushState(null, '', '/signup');
    setAuthView('signup');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return authView === 'signup' ? (
      <Signup onLogin={showLogin} />
    ) : (
      <Login onSignup={showSignup} />
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <button
          className="text-2xl font-bold"
          onClick={() => setView({ name: 'projects' })}
        >
          Secrets Manager
        </button>
        <div className="flex items-center gap-4">
          {identity?.isSuperadmin && view.name !== 'admin' && (
            <Button variant="outline" onClick={() => setView({ name: 'admin' })}>
              Access
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            {identity?.name}
            {identity?.isSuperadmin && ' (superadmin)'}
          </span>
          <Button variant="outline" onClick={logout}>
            Logout
          </Button>
        </div>
      </div>

      {view.name === 'projects' && (
        <Projects onSelect={(p) => setView({ name: 'project', project: p })} />
      )}
      {view.name === 'project' && (
        <ProjectDetail
          project={view.project}
          onBack={() => setView({ name: 'projects' })}
        />
      )}
      {view.name === 'admin' && (
        <Admin onBack={() => setView({ name: 'projects' })} />
      )}
    </div>
  );
}

export default App
