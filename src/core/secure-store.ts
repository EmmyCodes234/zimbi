import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

export interface SecureSession {
  accountId: string;
  email: string;
  name?: string;
  sessionToken: string; // zmb_sess_...
  createdAt: string;
}

export interface ProjectKeyEntry {
  projectId: string;
  environment: 'test' | 'production';
  apiKey: string; // zmb_test_... or zmb_live_...
}

export interface SecureVault {
  session?: SecureSession;
  projectKeys: Record<string, ProjectKeyEntry>;
}

const GLOBAL_ZIMBI_DIR = path.join(os.homedir(), '.zimbi');
const VAULT_FILE = path.join(GLOBAL_ZIMBI_DIR, 'credentials.vault');

/**
 * Windows DPAPI Encryption using PowerShell System.Security.Cryptography.ProtectedData
 */
function encryptDpapiWindows(plaintext: string): string {
  const bytes = Buffer.from(plaintext, 'utf8').toString('base64');
  const script = `
    Add-Type -AssemblyName System.Security;
    $bytes = [System.Convert]::FromBase64String('${bytes}');
    $enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
    [System.Convert]::ToBase64String($enc);
  `.replace(/\r?\n\s*/g, ' ');

  try {
    const output = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return `DPAPI:${output.trim()}`;
  } catch (err: any) {
    // Fallback to AES-256-GCM machine vault if PowerShell fails
    return encryptFallbackVault(plaintext);
  }
}

/**
 * Windows DPAPI Decryption
 */
function decryptDpapiWindows(ciphertext: string): string {
  const clean = ciphertext.replace(/^DPAPI:/, '').trim();
  const script = `
    Add-Type -AssemblyName System.Security;
    $bytes = [System.Convert]::FromBase64String('${clean}');
    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
    [System.Text.Encoding]::UTF8.GetString($dec);
  `.replace(/\r?\n\s*/g, ' ');

  const output = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return output.trim();
}

/**
 * Portable AES-256-GCM machine-derived vault for POSIX or fallback
 */
function getMachineDerivedKey(): Buffer {
  const machineSeed = `${os.hostname()}:${os.userInfo().username}:${os.homedir()}:zimbi-vault-v1`;
  return crypto.createHash('sha256').update(machineSeed).digest();
}

function encryptFallbackVault(plaintext: string): string {
  const key = getMachineDerivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `GCM:${iv.toString('hex')}:${authTag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptFallbackVault(ciphertext: string): string {
  const parts = ciphertext.replace(/^GCM:/, '').split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted vault format.');
  }
  const [ivHex, authTagHex, dataHex] = parts;
  const key = getMachineDerivedKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

let inMemoryVault: SecureVault | null = null;
let lastReadMtime: number = 0;

function protectSecret(plaintext: string): string {
  if (process.env.NODE_ENV === 'test' || process.env.ZIMBI_TEST === '1') {
    return encryptFallbackVault(plaintext);
  }
  if (process.platform === 'win32') {
    return encryptDpapiWindows(plaintext);
  }
  return encryptFallbackVault(plaintext);
}

function unprotectSecret(ciphertext: string): string {
  if (ciphertext.startsWith('GCM:')) {
    return decryptFallbackVault(ciphertext);
  }
  if (ciphertext.startsWith('DPAPI:') && process.platform === 'win32') {
    try {
      return decryptDpapiWindows(ciphertext);
    } catch {
      // Fallback
    }
  }
  // Try raw JSON parse if legacy plaintext exists
  try {
    JSON.parse(ciphertext);
    return ciphertext;
  } catch {
    throw new Error('Could not decrypt vault.');
  }
}

/**
 * Loads the secure vault from OS protected storage.
 */
export function getSecureVault(): SecureVault {
  if (!fs.existsSync(VAULT_FILE)) {
    return { projectKeys: {} };
  }

  try {
    const stat = fs.statSync(VAULT_FILE);
    if (inMemoryVault && stat.mtimeMs === lastReadMtime) {
      return inMemoryVault;
    }

    const raw = fs.readFileSync(VAULT_FILE, 'utf8').trim();
    if (!raw) return { projectKeys: {} };

    const decrypted = unprotectSecret(raw);
    const parsed = JSON.parse(decrypted);
    inMemoryVault = {
      session: parsed.session,
      projectKeys: parsed.projectKeys || {},
    };
    lastReadMtime = stat.mtimeMs;
    return inMemoryVault;
  } catch {
    return { projectKeys: {} };
  }
}

/**
 * Saves the secure vault to OS protected storage.
 */
export function saveSecureVault(vault: SecureVault): void {
  if (!fs.existsSync(GLOBAL_ZIMBI_DIR)) {
    fs.mkdirSync(GLOBAL_ZIMBI_DIR, { recursive: true });
  }

  const json = JSON.stringify(vault, null, 2);
  const protectedCipher = protectSecret(json);

  // Write with restricted permissions
  fs.writeFileSync(VAULT_FILE, protectedCipher, { encoding: 'utf8', mode: 0o600 });
  inMemoryVault = vault;
  try {
    lastReadMtime = fs.statSync(VAULT_FILE).mtimeMs;
  } catch {
    // ignore
  }
}

/**
 * Get active account session.
 */
export function getAccountSession(): SecureSession | null {
  const vault = getSecureVault();
  return vault.session || null;
}

/**
 * Save active account session.
 */
export function saveAccountSession(session: SecureSession): void {
  const vault = getSecureVault();
  vault.session = session;
  saveSecureVault(vault);
}

/**
 * Clear account session (logout).
 */
export function clearAccountSession(): void {
  const vault = getSecureVault();
  delete vault.session;
  saveSecureVault(vault);
}

/**
 * Get cached project API key.
 */
export function getProjectApiKey(projectId: string): string | null {
  const vault = getSecureVault();
  const entry = vault.projectKeys[projectId];
  return entry ? entry.apiKey : null;
}

/**
 * Store project API key securely.
 */
export function saveProjectApiKey(
  projectId: string,
  apiKey: string,
  environment: 'test' | 'production' = 'test'
): void {
  const vault = getSecureVault();
  vault.projectKeys[projectId] = {
    projectId,
    environment,
    apiKey,
  };
  saveSecureVault(vault);
}
