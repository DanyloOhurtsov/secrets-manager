import { api } from './api';
import type { Environment } from './projects';

export interface Secret {
  id: string;
  key: string;
  value: string | null; // populated only on explicit reveal
  canReveal: boolean;
  currentVersion: number | null;
  createdAt: string;
  updatedAt?: string;
}

// Дозволи актора в межах оточення — фронт ховає кнопки дій, яких немає.
export interface EnvironmentCapabilities {
  canReveal: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canRollback: boolean;
}

export interface SecretVersion {
  id: string;
  version: number;
  createdById: string | null;
  createdAt: string;
  note: string | null;
  keyVersion: string;
  isCurrent: boolean;
}

// --- Environments ---
export function listEnvironments(projectId: string) {
  return api<Environment[]>(`/projects/${projectId}/environments`);
}

export function createEnvironment(projectId: string, name: string) {
  return api<Environment>(`/projects/${projectId}/environments`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function renameEnvironment(
  projectId: string,
  environmentId: string,
  name: string,
) {
  return api<Environment>(
    `/projects/${projectId}/environments/${environmentId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  );
}

// --- Secrets ---
export function listSecrets(environmentId: string) {
  return api<Secret[]>(`/environments/${environmentId}/secrets`);
}

export function getEnvironmentCapabilities(environmentId: string) {
  return api<EnvironmentCapabilities>(
    `/environments/${environmentId}/secrets/capabilities`,
  );
}

export function createSecret(environmentId: string, key: string, value: string) {
  return api<{ id: string }>(`/environments/${environmentId}/secrets`, {
    method: 'POST',
    body: JSON.stringify({ key, value }),
  });
}

export interface ImportResult {
  created: number;
  updated: number;
  total: number;
}

// Bulk-імпорт із .env: надсилаємо сирий текст, бекенд парсить і створює/оновлює.
export function importSecrets(environmentId: string, content: string) {
  return api<ImportResult>(`/environments/${environmentId}/secrets/import`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function revealSecret(environmentId: string, secretId: string) {
  return api<{ id: string; value: string | null }>(
    `/environments/${environmentId}/secrets/${secretId}/reveal`,
  );
}

export function updateSecret(
  environmentId: string,
  secretId: string,
  value: string,
) {
  return api<{ id: string }>(
    `/environments/${environmentId}/secrets/${secretId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    },
  );
}

export function listSecretVersions(environmentId: string, secretId: string) {
  return api<SecretVersion[]>(
    `/environments/${environmentId}/secrets/${secretId}/versions`,
  );
}

export function rollbackSecret(
  environmentId: string,
  secretId: string,
  toVersion: number,
) {
  return api<{ id: string }>(
    `/environments/${environmentId}/secrets/${secretId}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ toVersion }),
    },
  );
}

export function deleteSecret(environmentId: string, secretId: string) {
  return api(`/environments/${environmentId}/secrets/${secretId}`, {
    method: 'DELETE',
  });
}
