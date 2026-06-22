export interface AuthPrincipal {
  id: string;
  name: string;
  email: string | null;
  type: string;
  isSuperadmin: boolean;
  serviceOrganizationId: string | null;
  authMethod: 'token' | 'session';
}
