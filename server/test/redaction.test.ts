import { test, describe } from 'node:test';
import assert from 'node:assert';
import { redactString, redactSecrets } from '../src/auth/redaction.js';

describe('ZIMBI Hard Redaction Layer', () => {
  test('redactString masks Paystack test and live keys', () => {
    const raw = 'Connected with sk_test_9cfc9486e64bdb472c976acc42b06d33ad5b5131 successfully.';
    const sanitized = redactString(raw);
    assert.strictEqual(sanitized, 'Connected with sk_test_*** successfully.');
    assert.strictEqual(sanitized.includes('9cfc'), false);
  });

  test('redactString masks ZIMBI API keys and Bearer tokens', () => {
    const raw = 'Header: Bearer zmb_test_abc1234567890XYZ';
    const sanitized = redactString(raw);
    assert.strictEqual(sanitized, 'Header: Bearer ***');
    assert.strictEqual(sanitized.includes('zmb_test_'), false);
  });

  test('redactSecrets deep-redacts sensitive object keys', () => {
    const payload = {
      provider: 'paystack',
      secretKey: 'sk_test_123456',
      credential_ciphertext: 's3cr3tC1ph3rT3xt==',
      metadata: {
        apiKey: 'zmb_test_99999',
        normalField: 'hello world',
      },
    };

    const redacted = redactSecrets(payload);
    assert.strictEqual(redacted.secretKey, '[REDACTED]');
    assert.strictEqual(redacted.credential_ciphertext, '[REDACTED]');
    assert.strictEqual(redacted.metadata.apiKey, '[REDACTED]');
    assert.strictEqual(redacted.metadata.normalField, 'hello world');
  });

  test('redactSecrets sanitizes Error message and stack trace', () => {
    const err = new Error('Failed to connect using sk_test_secret_val');
    const sanitizedErr = redactSecrets(err);

    assert.strictEqual(sanitizedErr.message, 'Failed to connect using sk_test_***');
    assert.strictEqual(sanitizedErr.message.includes('secret_val'), false);
  });
});
