export interface AuthPrincipal {
  id: string;
  name: string;
  email: string | null;
  type: string;
  isSuperadmin: boolean;
  serviceOrganizationId: string | null;
  authMethod: 'token' | 'session';
  // Внутрішній id поточної сесії — заповнюється ЛИШЕ для browser-сесій
  // (authMethod === 'session'), щоб logout міг відкликати саме її. Для API-токенів
  // (sm_...) лишається undefined. Назовні (напр. у /auth/me) не віддаємо.
  sessionId?: string;
}
