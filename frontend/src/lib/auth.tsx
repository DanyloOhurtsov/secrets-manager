import { createContext, useContext, useState, type ReactNode } from 'react';
import { api, getToken, setToken, clearToken } from './api';

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(!!getToken());

  async function login(token: string) {
    // тимчасово зберігаємо токен, щоб api() його використав
    setToken(token);
    try {
      // перевіряємо валідність: будь-який захищений ендпоінт
      await api('/projects');
      setIsAuthenticated(true);
    } catch (err) {
      clearToken();
      setIsAuthenticated(false);
      throw err;
    }
  }

  function logout() {
    clearToken();
    setIsAuthenticated(false);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
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
