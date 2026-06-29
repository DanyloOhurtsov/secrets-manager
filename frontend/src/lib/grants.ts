import { api } from './api';

// Гранти — площина даних. Керуються з рівня організації:
// /organizations/:orgId/grants. Org-роль (owner/admin/member) — площина
// керування і сама по собі НЕ дає доступу до значень секретів.

export interface GrantIdentity {
  id: string;
  name: string;
  email: string | null;
  type: string; // "human" | "service"
}

export interface OrgGrant {
  id: string;
  identityId: string;
  identity: GrantIdentity;
  projectId: string;
  projectName: string | null;
  scopeType: string; // "project" | "environment"
  scopeId: string;
  environmentName: string | null;
  role: string;
  canRevealSecrets: boolean;
  canCreateSecrets: boolean;
  canUpdateSecrets: boolean;
  canDeleteSecrets: boolean;
  canRollbackSecrets: boolean;
  // Read-only: легасі-колонка. API більше не приймає її на запис; нові гранти
  // завжди false. Лишаємо в типі лише для відображення старих рядків.
  canManageGrants: boolean;
  createdAt: string;
}

export interface GrantInput {
  identityId: string;
  projectId: string;
  environment?: string;
  role: string;
  canRevealSecrets?: boolean;
  canCreateSecrets?: boolean;
  canUpdateSecrets?: boolean;
  canDeleteSecrets?: boolean;
  canRollbackSecrets?: boolean;
}

export type GrantUpdateInput = Partial<
  Pick<
    GrantInput,
    | 'role'
    | 'environment'
    | 'canRevealSecrets'
    | 'canCreateSecrets'
    | 'canUpdateSecrets'
    | 'canDeleteSecrets'
    | 'canRollbackSecrets'
  >
>;

export function listOrgGrants(orgId: string) {
  return api<OrgGrant[]>(`/organizations/${orgId}/grants`);
}

export function createOrgGrant(orgId: string, input: GrantInput) {
  return api<OrgGrant>(`/organizations/${orgId}/grants`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateOrgGrant(
  orgId: string,
  grantId: string,
  input: GrantUpdateInput,
) {
  return api<OrgGrant>(`/organizations/${orgId}/grants/${grantId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function revokeOrgGrant(orgId: string, grantId: string) {
  return api(`/organizations/${orgId}/grants/${grantId}`, { method: 'DELETE' });
}
