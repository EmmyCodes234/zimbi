import crypto from 'node:crypto';
import { query } from '../db/connection.js';

export interface AccountContext {
  accountId: string;
  email: string;
  name?: string;
  sessionId: string;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Normalizes user codes like "l7qkdm2p" or "L7QK-DM2P" to "L7QK-DM2P"
 */
export function normalizeUserCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  }
  return clean;
}

/**
 * Creates or retrieves an account by email.
 */
export async function createOrGetAccount(
  email: string,
  name?: string
): Promise<{ id: string; email: string; name?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await query(
    `SELECT id, email, name FROM accounts WHERE email = $1`,
    [normalizedEmail]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const accountId = `acc_${crypto.randomBytes(8).toString('hex')}`;
  const displayName = name || normalizedEmail.split('@')[0];

  const res = await query(
    `INSERT INTO accounts (id, email, name, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
     RETURNING id, email, name`,
    [accountId, normalizedEmail, displayName]
  );

  return res.rows[0];
}

/**
 * Creates an account session token (zmb_sess_...).
 */
export async function createAccountSession(
  accountId: string,
  expiresInDays: number = 30
): Promise<{ sessionId: string; token: string }> {
  const sessionId = `sess_${crypto.randomBytes(8).toString('hex')}`;
  const randomSecret = crypto.randomBytes(32).toString('base64url');
  const token = `zmb_sess_${randomSecret}`;
  const tokenHash = hashToken(token);

  await query(
    `INSERT INTO account_sessions (
       id, account_id, token_prefix, token_hash, created_at, expires_at
     ) VALUES ($1, $2, 'zmb_sess_', $3, NOW(), NOW() + ($4 || ' days')::INTERVAL)`,
    [sessionId, accountId, tokenHash, expiresInDays.toString()]
  );

  return { sessionId, token };
}

/**
 * Verifies an account session token.
 * Validates that token is not revoked and not expired.
 */
export async function verifyAccountSession(token: string): Promise<AccountContext | null> {
  if (!token || !token.startsWith('zmb_sess_')) {
    return null;
  }

  const tokenHash = hashToken(token);
  const res = await query(
    `SELECT s.id as session_id, s.account_id, s.revoked_at, s.expires_at, a.email, a.name
     FROM account_sessions s
     JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
    [tokenHash]
  );

  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];

  // Asynchronously update last_used_at
  query(
    `UPDATE account_sessions SET last_used_at = NOW() WHERE id = $1`,
    [row.session_id]
  ).catch(() => {});

  return {
    accountId: row.account_id,
    email: row.email,
    name: row.name,
    sessionId: row.session_id,
  };
}

/**
 * Revokes a session token actively.
 */
export async function revokeAccountSession(sessionId: string): Promise<boolean> {
  const res = await query(
    `UPDATE account_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId]
  );
  return (res.rowCount || 0) > 0;
}

/**
 * Generates user-friendly character sequence for device authorization.
 * Excludes easily confusable characters (0, O, 1, I).
 */
function generateReadableUserCode(): string {
  const charset = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += charset[crypto.randomInt(0, charset.length)];
    part2 += charset[crypto.randomInt(0, charset.length)];
  }
  return `${part1}-${part2}`;
}

/**
 * Request device authorization (RFC 8628 Vercel-style device login).
 */
export async function requestDeviceAuthorization(
  clientMetadata: Record<string, any> = {}
): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  const id = `dvc_${crypto.randomBytes(8).toString('hex')}`;
  const deviceCode = `dvc_${crypto.randomBytes(24).toString('base64url')}`;
  const userCode = generateReadableUserCode();
  const expiresIn = 600; // 10 minutes
  const interval = 2; // 2 seconds polling interval

  await query(
    `INSERT INTO device_codes (
       id, device_code, user_code, status, attempt_count, client_metadata, expires_at, created_at
     ) VALUES ($1, $2, $3, 'pending', 0, $4, NOW() + INTERVAL '10 minutes', NOW())`,
    [id, deviceCode, userCode, JSON.stringify(clientMetadata)]
  );

  return {
    deviceCode,
    userCode,
    verificationUri: '/device',
    expiresIn,
    interval,
  };
}

/**
 * Fetches information for a user code for the web UI.
 */
export async function getDeviceCodeDetails(userCode: string): Promise<{
  valid: boolean;
  userCode?: string;
  clientMetadata?: any;
  status?: string;
  error?: string;
}> {
  const normalized = normalizeUserCode(userCode);
  const res = await query(
    `SELECT user_code, status, attempt_count, client_metadata, expires_at
     FROM device_codes
     WHERE user_code = $1`,
    [normalized]
  );

  if (res.rows.length === 0) {
    return { valid: false, error: 'Code not found. Please check your terminal.' };
  }

  const row = res.rows[0];

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { valid: false, error: 'Code has expired. Please run zimbi login again.' };
  }

  if (row.attempt_count >= 5 || row.status === 'denied') {
    return { valid: false, error: 'Too many invalid attempts. Code locked for security.' };
  }

  if (row.status !== 'pending') {
    return { valid: false, error: `Code is already ${row.status}.` };
  }

  return {
    valid: true,
    userCode: row.user_code,
    clientMetadata: row.client_metadata,
    status: row.status,
  };
}

/**
 * Authorizes a device code in the browser after user authentication.
 */
export async function authorizeDeviceCode(
  userCode: string,
  accountId: string
): Promise<{ success: boolean; error?: string }> {
  const normalized = normalizeUserCode(userCode);

  // Check attempt limits
  const res = await query(
    `SELECT id, status, attempt_count, expires_at FROM device_codes WHERE user_code = $1`,
    [normalized]
  );

  if (res.rows.length === 0) {
    return { success: false, error: 'Invalid verification code.' };
  }

  const row = res.rows[0];

  if (row.attempt_count >= 5) {
    await query(`UPDATE device_codes SET status = 'denied' WHERE id = $1`, [row.id]);
    return { success: false, error: 'Too many attempts. This code is now invalid.' };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query(`UPDATE device_codes SET status = 'expired' WHERE id = $1`, [row.id]);
    return { success: false, error: 'Verification code has expired.' };
  }

  if (row.status !== 'pending') {
    return { success: false, error: `Verification code was already ${row.status}.` };
  }

  // Atomically approve
  const updateRes = await query(
    `UPDATE device_codes
     SET status = 'approved', account_id = $2, approved_at = NOW()
     WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
     RETURNING id`,
    [row.id, accountId]
  );

  if ((updateRes.rowCount || 0) === 0) {
    return { success: false, error: 'Failed to approve. Code may have expired.' };
  }

  return { success: true };
}

/**
 * Polls for token exchange on behalf of the CLI.
 * Single-use: once exchanged, device code is marked 'consumed' and cannot be reused.
 */
export async function pollDeviceToken(deviceCode: string): Promise<{
  status: 'pending' | 'approved' | 'expired' | 'denied';
  sessionToken?: string;
  account?: { id: string; email: string; name?: string };
  error?: string;
}> {
  const res = await query(
    `SELECT d.id, d.status, d.account_id, d.expires_at, a.email, a.name
     FROM device_codes d
     LEFT JOIN accounts a ON a.id = d.account_id
     WHERE d.device_code = $1`,
    [deviceCode]
  );

  if (res.rows.length === 0) {
    return { status: 'denied', error: 'Invalid device code.' };
  }

  const row = res.rows[0];

  if (new Date(row.expires_at).getTime() < Date.now()) {
    if (row.status === 'pending') {
      await query(`UPDATE device_codes SET status = 'expired' WHERE id = $1`, [row.id]);
    }
    return { status: 'expired', error: 'Device code has expired.' };
  }

  if (row.status === 'pending') {
    return { status: 'pending' };
  }

  if (row.status === 'denied') {
    return { status: 'denied', error: 'Authorization was denied or code was locked.' };
  }

  if (row.status === 'consumed') {
    return { status: 'denied', error: 'Device code was already consumed (single-use).' };
  }

  if (row.status === 'approved') {
    // Single-use exchange: atomically transition to 'consumed'
    const consumeRes = await query(
      `UPDATE device_codes
       SET status = 'consumed'
       WHERE id = $1 AND status = 'approved'
       RETURNING id`,
      [row.id]
    );

    if ((consumeRes.rowCount || 0) === 0) {
      return { status: 'denied', error: 'Authorization already consumed.' };
    }

    // Issue session token
    const session = await createAccountSession(row.account_id);
    return {
      status: 'approved',
      sessionToken: session.token,
      account: {
        id: row.account_id,
        email: row.email,
        name: row.name,
      },
    };
  }

  return { status: 'denied' };
}
