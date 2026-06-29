import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

interface RouterValue {
  path: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback(
    (to: string, opts?: { replace?: boolean }) => {
      if (to === window.location.pathname) {
        setPath(to);
        return;
      }
      if (opts?.replace) window.history.replaceState(null, '', to);
      else window.history.pushState(null, '', to);
      setPath(to);
    },
    [],
  );

  return (
    <RouterContext.Provider value={{ path, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}

// Розбирає шлях на сегменти (без порожніх).
// eslint-disable-next-line react-refresh/only-export-components
export function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}
