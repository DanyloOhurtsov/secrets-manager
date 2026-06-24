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
  renameEnvironment as apiRenameEnv,
  listSecrets as apiListSecrets,
  getEnvironmentCapabilities as apiGetCapabilities,
  createSecret as apiCreateSecret,
  updateSecret as apiUpdateSecret,
  rollbackSecret as apiRollbackSecret,
  listSecretVersions as apiListVersions,
  revealSecret as apiRevealSecret,
  deleteSecret as apiDeleteSecret,
  type Secret,
  type SecretVersion,
  type EnvironmentCapabilities,
} from './secrets';
import type { Environment } from './projects';

interface SecretsContextValue {
  getEnvironments: (projectId: string) => Environment[] | undefined;
  loadEnvironments: (projectId: string) => Promise<Environment[]>;
  createEnvironment: (projectId: string, name: string) => Promise<Environment>;
  renameEnvironment: (
    projectId: string,
    envId: string,
    name: string,
  ) => Promise<Environment>;
  getSecrets: (envId: string) => Secret[] | undefined;
  loadSecrets: (envId: string) => Promise<void>;
  getCapabilities: (envId: string) => EnvironmentCapabilities | undefined;
  loadCapabilities: (envId: string) => Promise<void>;
  createSecret: (envId: string, key: string, value: string) => Promise<void>;
  updateSecret: (envId: string, id: string, value: string) => Promise<void>;
  rollbackSecret: (envId: string, id: string, toVersion: number) => Promise<void>;
  loadVersions: (envId: string, id: string) => Promise<SecretVersion[]>;
  revealSecret: (envId: string, id: string) => Promise<string | null>;
  deleteSecret: (envId: string, id: string) => Promise<void>;
}

const SecretsContext = createContext<SecretsContextValue | null>(null);

export function SecretsProvider({ children }: { children: ReactNode }) {
  const [envsByProject, setEnvsByProject] = useState<Record<string, Environment[]>>({});
  const [secretsByEnv, setSecretsByEnv] = useState<Record<string, Secret[]>>({});
  const [capsByEnv, setCapsByEnv] = useState<
    Record<string, EnvironmentCapabilities>
  >({});
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

  const renameEnvironment = useCallback(
    async (projectId: string, envId: string, name: string) => {
      const updated = await apiRenameEnv(projectId, envId, name);
      setEnvsByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).map((e) =>
          e.id === envId ? updated : e,
        ),
      }));
      return updated;
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

  const getCapabilities = useCallback(
    (envId: string) => capsByEnv[envId],
    [capsByEnv],
  );

  const loadCapabilities = useCallback(
    async (envId: string) => {
      if (capsByEnv[envId]) return;
      const key = `caps:${envId}`;
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      try {
        const caps = await apiGetCapabilities(envId);
        setCapsByEnv((prev) => ({ ...prev, [envId]: caps }));
      } finally {
        inflight.current.delete(key);
      }
    },
    [capsByEnv],
  );

  const createSecret = useCallback(
    async (envId: string, key: string, value: string) => {
      await apiCreateSecret(envId, key, value);
      const secrets = await apiListSecrets(envId);
      setSecretsByEnv((prev) => ({ ...prev, [envId]: secrets }));
    },
    [],
  );

  const refresh = useCallback(async (envId: string) => {
    const secrets = await apiListSecrets(envId);
    setSecretsByEnv((prev) => ({ ...prev, [envId]: secrets }));
  }, []);

  const updateSecret = useCallback(
    async (envId: string, id: string, value: string) => {
      await apiUpdateSecret(envId, id, value);
      await refresh(envId);
    },
    [refresh],
  );

  const rollbackSecret = useCallback(
    async (envId: string, id: string, toVersion: number) => {
      await apiRollbackSecret(envId, id, toVersion);
      await refresh(envId);
    },
    [refresh],
  );

  const loadVersions = useCallback(
    (envId: string, id: string) => apiListVersions(envId, id),
    [],
  );

  const revealSecret = useCallback(
    async (envId: string, id: string) => {
      const res = await apiRevealSecret(envId, id);
      return res.value;
    },
    [],
  );

  const deleteSecret = useCallback(
    async (envId: string, id: string) => {
      await apiDeleteSecret(envId, id);
      await refresh(envId);
    },
    [refresh],
  );

  return (
    <SecretsContext.Provider
      value={{
        getEnvironments,
        loadEnvironments,
        createEnvironment,
        renameEnvironment,
        getSecrets,
        loadSecrets,
        getCapabilities,
        loadCapabilities,
        createSecret,
        updateSecret,
        rollbackSecret,
        loadVersions,
        revealSecret,
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
