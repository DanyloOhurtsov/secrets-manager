import { api } from './api';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
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

export function createProject(name: string) {
  return api<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function getProject(id: string) {
  return api<Project>(`/projects/${id}`);
}
