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
  email: string | null;
  type: string;
  isSuperadmin: boolean;
  serviceOrganizationId: string | null;
  authMethod: 'token' | 'session';
}

interface AuthContextValue {
  identity: Identity | null;
  isAuthenticated: boolean;
  loading: boolean;
  loginWithToken: (token: string) => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

  async function loginWithToken(token: string) {
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

  async function loginWithPassword(email: string, password: string) {
    const res = await api<{ sessionToken: string; identity: Identity }>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
    );
    setToken(res.sessionToken);
    setIdentity(res.identity);
  }

  async function signup(name: string, email: string, password: string) {
    const res = await api<{ sessionToken: string; identity: Identity }>(
      '/signup',
      {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      },
    );
    setToken(res.sessionToken);
    setIdentity(res.identity);
  }

  async function logout() {
    // Browser-сесію відкликаємо на бекенді (M2), щоб вкрадений sess_-токен не
    // лишався валідним до кінця TTL. Спершу revoke (поки токен ще в localStorage),
    // потім чистимо локально. Помилку ковтаємо — локальний logout робимо завжди;
    // бекенд усе одно відхилятиме сесію, якщо її таки відкликали.
    try {
      if (identity?.authMethod === 'session') {
        await api('/auth/session', { method: 'DELETE' });
      }
    } catch {
      // ignore — clear local state regardless of revoke outcome
    } finally {
      clearToken();
      setIdentity(null);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        identity,
        isAuthenticated: !!identity,
        loading,
        loginWithToken,
        loginWithPassword,
        signup,
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
