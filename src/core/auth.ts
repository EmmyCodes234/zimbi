import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UserSession } from '../types/index.js';
import { readEnvApiKey } from './config.js';

const GLOBAL_ZIMBI_DIR = path.join(os.homedir(), '.zimbi');
const CREDENTIALS_FILE = path.join(GLOBAL_ZIMBI_DIR, 'credentials.json');

export function getGlobalSession(): UserSession | null {
  // Check process env or local .env first
  const envKey = process.env.ZIMBI_API_KEY || readEnvApiKey();

  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      const session = JSON.parse(raw) as UserSession;
      if (session && session.token) {
        return session;
      }
    } catch {
      // Fallback
    }
  }

  if (envKey) {
    return {
      email: 'api-key-user@zimbi.dev',
      userId: 'usr_apikey',
      token: envKey,
      projects: [
        { id: 'proj_default', name: 'default', createdAt: new Date().toISOString() },
      ],
    };
  }

  return null;
}

export function saveGlobalSession(session: UserSession): void {
  if (!fs.existsSync(GLOBAL_ZIMBI_DIR)) {
    fs.mkdirSync(GLOBAL_ZIMBI_DIR, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(session, null, 2), 'utf8');
}

export function clearGlobalSession(): void {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
  }
}

export function isAuthenticated(): boolean {
  return getGlobalSession() !== null;
}
