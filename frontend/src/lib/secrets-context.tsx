import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  listEnvironments as apiListEnvs,
  createEnvironment as apiCreateEnv,
  listSecrets as apiListSecrets,
  createSecret as apiCreateSecret,
  deleteSecret as apiDeleteSecret,
  type Secret,
} from './secrets';
import type { Environment } from './projects';

interface SecretsContextValue {
  getEnvironments: (projectId: string) => Environment[] | undefined;
  loadEnvironments: (projectId: string) => Promise<Environment[]>;
  createEnvironment: (projectId: string, name: string) => Promise<Environment>;
  getSecrets: (envId: string) => Secret[] | undefined;
  loadSecrets: (envId: string) => Promise<void>;
  createSecret: (envId: string, key: string, value: string) => Promise<void>;
  deleteSecret: (envId: string, id: string) => Promise<void>;
}

const SecretsContext = createContext<SecretsContextValue | null>(null);

export function SecretsProvider({ children }: { children: ReactNode }) {
  const [envsByProject, setEnvsByProject] = useState<Record<string, Environment[]>>({});
  const [secretsByEnv, setSecretsByEnv] = useState<Record<string, Secret[]>>({});
  // щоб не робити паралельні запити того самого
  const inflight = useRef<Set<string>>(new Set());

  const getEnvironments = useCallback(
    (projectId: string) => envsByProject[projectId],
    [envsByProject],
  );

  const loadEnvironments = useCallback(async (projectId: string) => {
    if (envsByProject[projectId]) return envsByProject[projectId];
    const key = `envs:${projectId}`;
    if (inflight.current.has(key)) return [];
    inflight.current.add(key);
    try {
      const envs = await apiListEnvs(projectId);
      setEnvsByProject((prev) => ({ ...prev, [projectId]: envs }));
      return envs;
    } finally {
      inflight.current.delete(key);
    }
  }, [envsByProject]);

  const createEnvironment = useCallback(
    async (projectId: string, name: string) => {
      const created = await apiCreateEnv(projectId, name);
      const envs = await apiListEnvs(projectId);
      setEnvsByProject((prev) => ({ ...prev, [projectId]: envs }));
      return created;
    },
    [],
  );

  const getSecrets = useCallback(
    (envId: string) => secretsByEnv[envId],
    [secretsByEnv],
  );

  const loadSecrets = useCallback(async (envId: string) => {
    if (secretsByEnv[envId]) return;
    const key = `secrets:${envId}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    try {
      const secrets = await apiListSecrets(envId);
      setSecretsByEnv((prev) => ({ ...prev, [envId]: secrets }));
    } finally {
      inflight.current.delete(key);
    }
  }, [secretsByEnv]);

  const createSecret = useCallback(
    async (envId: string, key: string, value: string) => {
      await apiCreateSecret(envId, key, value);
      const secrets = await apiListSecrets(envId);
      setSecretsByEnv((prev) => ({ ...prev, [envId]: secrets }));
    },
    [],
  );

  const deleteSecret = useCallback(
    async (envId: string, id: string) => {
      await apiDeleteSecret(envId, id);
      const secrets = await apiListSecrets(envId);
      setSecretsByEnv((prev) => ({ ...prev, [envId]: secrets }));
    },
    [],
  );

  return (
    <SecretsContext.Provider
      value={{
        getEnvironments,
        loadEnvironments,
        createEnvironment,
        getSecrets,
        loadSecrets,
        createSecret,
        deleteSecret,
      }}
    >
      {children}
    </SecretsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSecrets() {
  const ctx = useContext(SecretsContext);
  if (!ctx) throw new Error('useSecrets must be used within SecretsProvider');
  return ctx;
}
