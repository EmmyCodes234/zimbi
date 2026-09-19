import { test, describe } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  encryptCredential,
  decryptCredential,
} from '../src/auth/encryption.js';

describe('ZIMBI Credential Encryption (AES-256-GCM)', () => {
  const testMasterKey = crypto.randomBytes(32);
  const secretKey = 'sk_test_9cfc9486e64bdb472c976acc42b06d33ad5b5131';

  test('round-trip encrypt and decrypt succeeds', () => {
    const encrypted = encryptCredential(secretKey, 1, testMasterKey);
    assert.ok(encrypted.ciphertext);
    assert.ok(encrypted.iv);
    assert.ok(encrypted.authTag);
    assert.strictEqual(encrypted.keyVersion, 1);
    assert.notStrictEqual(encrypted.ciphertext, secretKey);

    const decrypted = decryptCredential(encrypted, testMasterKey);
    assert.strictEqual(decrypted, secretKey);
  });

  test('generates unique IV for each encryption of the same plaintext', () => {
    const enc1 = encryptCredential(secretKey, 1, testMasterKey);
    const enc2 = encryptCredential(secretKey, 1, testMasterKey);

    assert.notStrictEqual(enc1.iv, enc2.iv);
    assert.notStrictEqual(enc1.ciphertext, enc2.ciphertext);
    assert.notStrictEqual(enc1.authTag, enc2.authTag);

    assert.strictEqual(decryptCredential(enc1, testMasterKey), secretKey);
    assert.strictEqual(decryptCredential(enc2, testMasterKey), secretKey);
  });

  test('detects tampered ciphertext and throws error', () => {
    const encrypted = encryptCredential(secretKey, 1, testMasterKey);
    // Tamper with ciphertext
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from('corrupted_ciphertext_data').toString('base64'),
    };

    assert.throws(
      () => decryptCredential(tampered, testMasterKey),
      /Credential decryption failed/
    );
  });

  test('detects tampered auth tag and throws error', () => {
    const encrypted = encryptCredential(secretKey, 1, testMasterKey);
    // Tamper with auth tag
    const tampered = {
      ...encrypted,
      authTag: crypto.randomBytes(16).toString('hex'),
    };

    assert.throws(
      () => decryptCredential(tampered, testMasterKey),
      /Credential decryption failed/
    );
  });

  test('fails decryption when wrong master key is used', () => {
    const encrypted = encryptCredential(secretKey, 1, testMasterKey);
    const wrongKey = crypto.randomBytes(32);

    assert.throws(
      () => decryptCredential(encrypted, wrongKey),
      /Credential decryption failed/
    );
  });
});
