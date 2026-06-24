import { api } from './api';

export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  createdAt: string;
  _count: {
    memberships: number;
    projects: number;
    serviceAccounts: number;
  };
}

export interface Health {
  status: string;
  database: boolean;
  cache: boolean;
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

// --- Platform: organizations (metadata + suspension, no secrets) ---
export function listPlatformOrganizations() {
  return api<PlatformOrganization[]>('/admin/organizations');
}

export function suspendOrganization(id: string) {
  return api<{ id: string; status: string }>(
    `/admin/organizations/${id}/suspend`,
    { method: 'POST' },
  );
}

export function unsuspendOrganization(id: string) {
  return api<{ id: string; status: string }>(
    `/admin/organizations/${id}/unsuspend`,
    { method: 'POST' },
  );
}

// --- Platform: system ---
export function getHealth() {
  return api<Health>('/admin/health');
}

export function rotateKeys() {
  return api<{ activeVersion: string; rotated: number; failed: string[] }>(
    '/admin/rotate-keys',
    { method: 'POST' },
  );
}

// --- Audit (scoped per actor on /audit, global on /admin/audit) ---
export interface AuditFilters {
  action?: string | string[];
  organizationId?: string;
  projectId?: string;
  environmentId?: string;
  actorId?: string;
  targetType?: string;
  from?: string;
  to?: string;
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
  appendQueryParam(params, 'actorId', filters.actorId);
  appendQueryParam(params, 'targetType', filters.targetType);
  appendQueryParam(params, 'from', filters.from);
  appendQueryParam(params, 'to', filters.to);

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
