import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter, segments } from '@/lib/router';
import { getActiveOrg } from '@/lib/account';
import { listMyOrganizations } from '@/lib/organizations';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { OrgWorkspace } from '@/pages/OrgWorkspace';
import { OrgSwitcher } from '@/pages/OrgSwitcher';
import { AccountSettings } from '@/pages/Settings';
import { Admin } from '@/pages/Admin';
import { CommandPalette } from '@/pages/CommandPalette';
import { Button } from '@/components/ui/button';

function App() {
  const { identity, isAuthenticated, loading, logout } = useAuth();
  const { path, navigate } = useRouter();
  const [accountOpen, setAccountOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return path === '/signup' ? (
      <Signup onLogin={() => navigate('/login')} />
    ) : (
      <Login onSignup={() => navigate('/signup')} />
    );
  }

  const segs = segments(path);
  const currentOrgId = segs[0] === 'orgs' ? (segs[1] ?? null) : null;

  let content;
  if (segs[0] === 'orgs' && segs[1]) {
    const tab = segs[2] ?? 'projects';
    const projectId =
      tab === 'projects' && segs[3] ? segs[3] : undefined;
    content = (
      <OrgWorkspace
        key={segs[1]}
        orgId={segs[1]}
        tab={tab}
        projectId={projectId}
      />
    );
  } else if (segs[0] === 'admin') {
    content = <Admin onBack={() => navigate('/')} />;
  } else {
    content = <RootRedirect />;
  }

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button className="text-2xl font-bold" onClick={() => navigate('/')}>
            Secrets Manager
          </button>
          <OrgSwitcher currentOrgId={currentOrgId} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              window.dispatchEvent(new Event('open-command-palette'))
            }
          >
            Search ⌘K
          </Button>
          <Button variant="ghost" onClick={() => setAccountOpen(true)}>
            Account
          </Button>
          {identity?.isSuperadmin && (
            <Button variant="outline" onClick={() => navigate('/admin')}>
              Platform
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-2">
            {identity?.name}
            {identity?.isSuperadmin && ' (superadmin)'}
          </span>
          <Button variant="outline" onClick={logout}>
            Logout
          </Button>
        </div>
      </div>

      {content}
      <AccountSettings open={accountOpen} onOpenChange={setAccountOpen} />
      <CommandPalette />
    </div>
  );
}

// Визначає дефолтну точку входу: остання активна org → перша доступна → порожньо.
function RootRedirect() {
  const { navigate } = useRouter();
  const [message, setMessage] = useState('Loading...');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { organizationId } = await getActiveOrg();
        let target = organizationId;
        if (!target) {
          const orgs = await listMyOrganizations();
          target = orgs[0]?.id ?? null;
        }
        if (cancelled) return;
        if (target) navigate(`/orgs/${target}/projects`, { replace: true });
        else setMessage('No workspaces available.');
      } catch {
        if (!cancelled) setMessage('Failed to load workspaces.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return <p className="text-muted-foreground">{message}</p>;
}

export default App;
