import { api } from './api';

export interface ServiceAccount {
  id: string;
  name: string;
  type: string;
  serviceOrganizationId: string | null;
  createdAt: string;
}

export interface ServiceAccountToken {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export function listServiceAccounts(orgId: string) {
  return api<ServiceAccount[]>(`/organizations/${orgId}/service-accounts`);
}

export function createServiceAccount(orgId: string, name: string) {
  return api<ServiceAccount>(`/organizations/${orgId}/service-accounts`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteServiceAccount(orgId: string, identityId: string) {
  return api(`/organizations/${orgId}/service-accounts/${identityId}`, {
    method: 'DELETE',
  });
}

export function listServiceAccountTokens(orgId: string, identityId: string) {
  return api<ServiceAccountToken[]>(
    `/organizations/${orgId}/service-accounts/${identityId}/tokens`,
  );
}

export function issueServiceAccountToken(
  orgId: string,
  identityId: string,
  label?: string,
  expiresInDays?: number,
) {
  return api<{ token: string }>(
    `/organizations/${orgId}/service-accounts/${identityId}/tokens`,
    {
      method: 'POST',
      body: JSON.stringify({ label, expiresInDays }),
    },
  );
}

export function revokeServiceAccountToken(
  orgId: string,
  identityId: string,
  tokenId: string,
) {
  return api(
    `/organizations/${orgId}/service-accounts/${identityId}/tokens/${tokenId}`,
    { method: 'DELETE' },
  );
}
