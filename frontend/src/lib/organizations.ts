import { api } from './api';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: string; // "personal" | "team"
  status: string;
  createdAt: string;
  role?: string; // present in listMine()
}

export interface OrgMember {
  identityId: string;
  name: string;
  email: string | null;
  type: string;
  role: string;
}

export interface OrgDetail extends Organization {
  myRole: string;
  members: OrgMember[];
  projects: { id: string; name: string; createdAt: string }[];
}

export function listMyOrganizations() {
  return api<Organization[]>('/organizations');
}

export function getOrganization(id: string) {
  return api<OrgDetail>(`/organizations/${id}`);
}

export function createOrganization(name: string) {
  return api<Organization>('/organizations', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function renameOrganization(id: string, name: string) {
  return api<Organization>(`/organizations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteOrganization(id: string) {
  return api(`/organizations/${id}`, { method: 'DELETE' });
}

export interface AddedMember {
  id: string;
  identityId: string;
  name: string;
  email: string | null;
  role: string;
}

export function addMember(id: string, email: string, role: string) {
  return api<AddedMember>(`/organizations/${id}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export function changeMemberRole(id: string, identityId: string, role: string) {
  return api(`/organizations/${id}/members/${identityId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export function removeMember(id: string, identityId: string) {
  return api(`/organizations/${id}/members/${identityId}`, {
    method: 'DELETE',
  });
}

export function transferOwnership(id: string, identityId: string) {
  return api(`/organizations/${id}/transfer-ownership`, {
    method: 'POST',
    body: JSON.stringify({ identityId }),
  });
}
