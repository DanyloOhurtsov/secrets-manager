import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Login } from '@/pages/Login';
import { Projects } from '@/pages/Projects';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/projects';

function App() {
  const { isAuthenticated, logout } = useAuth();
  const [selected, setSelected] = useState<Project | null>(null);

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Secrets Manager</h1>
        <Button variant="outline" onClick={logout}>
          Logout
        </Button>
      </div>
      {selected ? (
        <ProjectDetail project={selected} onBack={() => setSelected(null)} />
      ) : (
        <Projects onSelect={setSelected} />
      )}
    </div>
  );
}

export default App
