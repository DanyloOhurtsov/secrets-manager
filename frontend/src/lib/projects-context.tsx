import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { listProjects, createProject as apiCreate, type Project } from './projects';
import { useAuth } from './auth';

interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  create: (name: string) => Promise<Project>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listProjects();
      setProjects(list);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  // Завантажуємо один раз, коли користувач залогінений (і ще не завантажено).
  useEffect(() => {
    if (isAuthenticated && !loaded) {
      void reload();
    }
    // скидаємо стан при логауті
    if (!isAuthenticated && loaded) {
      setProjects([]);
      setLoaded(false);
    }
  }, [isAuthenticated, loaded, reload]);

  async function create(name: string) {
    const created = await apiCreate(name);
    await reload();
    return created;
  }

  return (
    <ProjectsContext.Provider
      value={{ projects, loading, error, reload, create }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}
