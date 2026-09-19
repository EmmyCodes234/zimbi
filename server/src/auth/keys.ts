import crypto from 'node:crypto';
import { query } from '../db/connection.js';

export interface GeneratedApiKey {
  keyId: string;
  plaintextKey: string;
  prefix: string;
  environment: 'test' | 'production';
}

export interface AuthenticatedContext {
  projectId: string;
  projectName: string;
  environment: 'test' | 'production';
  keyId: string;
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function generateProjectApiKey(
  projectId: string,
  environment: 'test' | 'production' = 'test'
): Promise<GeneratedApiKey> {
  const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;
  const randomSecret = crypto.randomBytes(24).toString('base64url');
  const prefix = environment === 'production' ? 'zmb_live_' : 'zmb_test_';
  const plaintextKey = `${prefix}${randomSecret}`;
  const keyHash = hashApiKey(plaintextKey);

  await query(
    `INSERT INTO api_keys (key_id, project_id, key_prefix, key_hash, environment, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [keyId, projectId, prefix, keyHash, environment]
  );

  return {
    keyId,
    plaintextKey,
    prefix,
    environment,
  };
}

export async function verifyApiKey(bearerToken: string): Promise<AuthenticatedContext | null> {
  // Project API keys MUST start with zmb_test_ or zmb_live_
  // Session tokens (zmb_sess_) are handled by verifyAccountSession
  if (!bearerToken || (!bearerToken.startsWith('zmb_test_') && !bearerToken.startsWith('zmb_live_'))) {
    return null;
  }

  const keyHash = hashApiKey(bearerToken);
  const result = await query(
    `SELECT k.key_id, k.project_id, k.environment, p.name as project_name, k.revoked_at
     FROM api_keys k
     JOIN projects p ON p.id = k.project_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [keyHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Asynchronously record last_used_at
  query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE key_id = $1`,
    [row.key_id]
  ).catch(() => {});

  return {
    projectId: row.project_id,
    projectName: row.project_name,
    environment: row.environment as 'test' | 'production',
    keyId: row.key_id,
  };
}
