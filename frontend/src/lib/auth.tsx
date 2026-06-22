import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { api, getToken, setToken, clearToken } from './api';

export interface Identity {
  id: string;
  name: string;
  type: string;
  isSuperadmin: boolean;
}

interface AuthContextValue {
  identity: Identity | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);

  // при старті: якщо є збережений токен — спробувати відновити сесію
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<Identity>('/auth/me')
      .then((me) => setIdentity(me))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function login(token: string) {
    setToken(token);
    try {
      const me = await api<Identity>('/auth/me');
      setIdentity(me);
    } catch (err) {
      clearToken();
      setIdentity(null);
      throw err;
    }
  }

  function logout() {
    clearToken();
    setIdentity(null);
  }

  return (
    <AuthContext.Provider
      value={{
        identity,
        isAuthenticated: !!identity,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
