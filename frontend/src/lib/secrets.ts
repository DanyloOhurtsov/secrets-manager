import { api } from './api';
import type { Environment } from './projects';

export interface Secret {
  id: string;
  key: string;
  value: string;
  createdAt: string;
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

// --- Secrets ---
export function listSecrets(environmentId: string) {
  return api<Secret[]>(`/environments/${environmentId}/secrets`);
}

export function createSecret(environmentId: string, key: string, value: string) {
  return api<{ id: string }>(`/environments/${environmentId}/secrets`, {
    method: 'POST',
    body: JSON.stringify({ key, value }),
  });
}

export function deleteSecret(environmentId: string, secretId: string) {
  return api(`/environments/${environmentId}/secrets/${secretId}`, {
    method: 'DELETE',
  });
}
