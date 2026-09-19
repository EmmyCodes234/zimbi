import {
  getAccountSession,
  saveAccountSession,
  clearAccountSession,
  getProjectApiKey,
  saveProjectApiKey,
  type SecureSession,
} from './secure-store.js';
import { readEnvApiKey } from './config.js';
import type { UserSession } from '../types/index.js';

export function getGlobalSession(): UserSession | null {
  // Check OS Secure Store first
  const secure = getAccountSession();
  if (secure && secure.sessionToken) {
    return {
      email: secure.email,
      userId: secure.accountId,
      token: secure.sessionToken,
      projects: [],
    };
  }

  // Fallback to environment variable or local .env
  const envKey = process.env.ZIMBI_API_KEY || readEnvApiKey();
  if (envKey) {
    return {
      email: 'api-key-user@zimbi.dev',
      userId: 'usr_apikey',
      token: envKey,
      projects: [{ id: 'proj_default', name: 'default', createdAt: new Date().toISOString() }],
    };
  }

  return null;
}

export function saveGlobalSession(session: UserSession): void {
  saveAccountSession({
    accountId: session.userId || 'acc_default',
    email: session.email,
    sessionToken: session.token,
    createdAt: new Date().toISOString(),
  });
}

export function clearGlobalSession(): void {
  clearAccountSession();
}

export function isAuthenticated(): boolean {
  return getAccountSession() !== null || Boolean(process.env.ZIMBI_API_KEY || readEnvApiKey());
}

export {
  getAccountSession,
  saveAccountSession,
  clearAccountSession,
  getProjectApiKey,
  saveProjectApiKey,
  type SecureSession,
};
