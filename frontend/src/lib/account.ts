import { api } from './api';

export interface PersonalToken {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export function listMyTokens() {
  return api<PersonalToken[]>('/me/tokens');
}

export function createMyToken(label?: string, expiresInDays?: number) {
  return api<{ token: string }>('/me/tokens', {
    method: 'POST',
    body: JSON.stringify({ label, expiresInDays }),
  });
}

export function revokeMyToken(tokenId: string) {
  return api(`/me/tokens/${tokenId}`, { method: 'DELETE' });
}

export function getActiveOrg() {
  return api<{ organizationId: string | null }>('/me/active-org');
}

export function setActiveOrg(organizationId: string) {
  return api<{ organizationId: string }>('/me/active-org', {
    method: 'PUT',
    body: JSON.stringify({ organizationId }),
  });
}
