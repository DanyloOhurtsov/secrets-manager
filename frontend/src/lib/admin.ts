import { api } from './api';

export interface Identity {
  id: string;
  name: string;
  type: string;
  isSuperadmin: boolean;
  createdAt: string;
}

export interface Token {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface Grant {
  id: string;
  identityId: string;
  projectId: string;
  environment: string | null;
  role: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  organizationId: string | null;
  organizationName: string | null;
  projectId: string | null;
  environmentId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// --- Identities ---
export function listIdentities() {
  return api<Identity[]>('/admin/identities');
}

export function createIdentity(name: string, type: string) {
  return api<Identity>('/admin/identities', {
    method: 'POST',
    body: JSON.stringify({ name, type }),
  });
}

// --- Tokens ---
export function listTokens(identityId: string) {
  return api<Token[]>(`/admin/identities/${identityId}/tokens`);
}

export function issueToken(identityId: string, label?: string) {
  return api<{ token: string }>(`/admin/identities/${identityId}/tokens`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export function revokeToken(tokenId: string) {
  return api(`/admin/tokens/${tokenId}`, { method: 'DELETE' });
}

// --- Grants ---
export function listGrants(identityId: string) {
  return api<Grant[]>(`/admin/identities/${identityId}/grants`);
}

export function createGrant(
  identityId: string,
  projectId: string,
  role: string,
  environment?: string,
) {
  return api<Grant>(`/admin/identities/${identityId}/grants`, {
    method: 'POST',
    body: JSON.stringify({ projectId, role, environment }),
  });
}

export function revokeGrant(grantId: string) {
  return api(`/admin/grants/${grantId}`, { method: 'DELETE' });
}

// --- Audit ---
export interface AuditFilters {
  action?: string | string[];
  organizationId?: string;
  projectId?: string;
  environmentId?: string;
}

function appendQueryParam(
  params: URLSearchParams,
  key: string,
  value?: string | string[],
) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item) params.append(key, item);
    }
    return;
  }
  params.set(key, value);
}

function auditQuery(filters: AuditFilters = {}) {
  const params = new URLSearchParams();
  appendQueryParam(params, 'action', filters.action);
  appendQueryParam(params, 'organizationId', filters.organizationId);
  appendQueryParam(params, 'projectId', filters.projectId);
  appendQueryParam(params, 'environmentId', filters.environmentId);

  return params.toString();
}

export function listAuditLog(filters: AuditFilters = {}) {
  const query = auditQuery(filters);
  return api<AuditEntry[]>(`/audit${query ? `?${query}` : ''}`);
}

export function listAuditActions(filters: Omit<AuditFilters, 'action'> = {}) {
  const query = auditQuery(filters);
  return api<string[]>(`/audit/actions${query ? `?${query}` : ''}`);
}
