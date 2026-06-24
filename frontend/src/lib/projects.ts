import { api } from './api';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  organizationId?: string;
  organization?: { id: string; name: string; type: string };
  environments?: Environment[];
}

export interface Environment {
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
}

export function listProjects() {
  return api<Project[]>('/projects');
}

export function listEnvironments(projectId: string) {
  return api<Environment[]>(`/projects/${projectId}/environments`);
}

export function createProject(name: string, organizationId?: string) {
  return api<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, organizationId }),
  });
}

export function getProject(id: string) {
  return api<Project>(`/projects/${id}`);
}

// Дозволи актора на рівні проєкту (без оточення) — для приховування структурних
// дій в UI, напр. кнопки створення нового оточення (потребує manageProject).
export interface ProjectCapabilities {
  listSecrets: boolean;
  revealSecrets: boolean;
  createSecrets: boolean;
  updateSecrets: boolean;
  deleteSecrets: boolean;
  rollbackSecrets: boolean;
  manageGrants: boolean;
  manageProject: boolean;
}

export function getProjectCapabilities(id: string) {
  return api<ProjectCapabilities>(`/projects/${id}/capabilities`);
}

export function transferProject(id: string, targetOrganizationId: string) {
  return api<{ transferred: boolean; revokedGrants: number }>(
    `/projects/${id}/transfer`,
    {
      method: 'POST',
      body: JSON.stringify({ targetOrganizationId }),
    },
  );
}
