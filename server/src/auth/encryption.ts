import crypto from 'node:crypto';

export interface EncryptedCredential {
  ciphertext: string; // base64
  iv: string;         // hex (12 bytes)
  authTag: string;    // hex (16 bytes)
  keyVersion: number;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM

/**
 * Resolves the 32-byte master encryption key from ZIMBI_CREDENTIAL_ENCRYPTION_KEY.
 * Falls back to a deterministic development key with warning if unset in dev/test.
 */
export function getMasterEncryptionKey(): Buffer {
  const envKey = process.env.ZIMBI_CREDENTIAL_ENCRYPTION_KEY;
  if (envKey) {
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    const buf = Buffer.from(envKey, 'base64');
    if (buf.length === 32) {
      return buf;
    }
    const rawBuf = Buffer.from(envKey, 'utf8');
    if (rawBuf.length === 32) {
      return rawBuf;
    }
    // If arbitrary string, derive 32 bytes using SHA-256
    return crypto.createHash('sha256').update(envKey).digest();
  }

  // Development/test fallback key (deterministic 32 bytes)
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CRITICAL: ZIMBI_CREDENTIAL_ENCRYPTION_KEY must be set in production');
  }

  return crypto
    .createHash('sha256')
    .update('zimbi_local_dev_credential_encryption_seed_key_v1')
    .digest();
}

/**
 * Encrypts a plaintext provider credential using AES-256-GCM.
 */
export function encryptCredential(
  plaintext: string,
  keyVersion: number = 1,
  customMasterKey?: Buffer
): EncryptedCredential {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty credential');
  }

  const masterKey = customMasterKey || getMasterEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    keyVersion,
  };
}

/**
 * Decrypts an encrypted credential using AES-256-GCM.
 * Throws if ciphertext or auth tag has been tampered with or if the key is incorrect.
 */
export function decryptCredential(
  encrypted: EncryptedCredential,
  customMasterKey?: Buffer
): string {
  if (!encrypted || !encrypted.ciphertext || !encrypted.iv || !encrypted.authTag) {
    throw new Error('Invalid encrypted credential payload');
  }

  const masterKey = customMasterKey || getMasterEncryptionKey();
  const iv = Buffer.from(encrypted.iv, 'hex');
  const authTag = Buffer.from(encrypted.authTag, 'hex');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    throw new Error('Credential decryption failed: invalid authentication tag or corrupted ciphertext');
  }
}

// Aliases for convenience across payment engine and routes
export const encryptSecret = encryptCredential;
export const decryptSecret = decryptCredential;

