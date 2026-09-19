import { test, describe } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { PaystackProvider } from '../src/providers/paystack.js';
import { hashApiKey } from '../src/auth/keys.js';

describe('ZIMBI Server - Core Security & Provider Integration', () => {
  const testSecret = 'sk_test_mock_secret_key_88192a';

  test('hashApiKey produces deterministic SHA-256 hash', () => {
    const key = 'zmb_test_abc123';
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
    assert.notStrictEqual(hash1, key);
  });

  test('PaystackProvider verifies valid HMAC-SHA512 webhook signature', () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: testSecret,
    });

    const payload = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 1234567,
        reference: 'pay_test_001_ref',
        amount: 2000000,
        currency: 'NGN',
        status: 'success',
      },
    });

    const validSignature = crypto
      .createHmac('sha512', testSecret)
      .update(payload)
      .digest('hex');

    const isValid = provider.verifyWebhookSignature(validSignature, payload);
    assert.strictEqual(isValid, true, 'Valid HMAC signature should verify');
  });

  test('PaystackProvider rejects invalid or tampered HMAC-SHA512 signature', () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: testSecret,
    });

    const payload = JSON.stringify({
      event: 'charge.success',
      data: { amount: 2000000 },
    });

    const tamperedSignature = crypto
      .createHmac('sha512', 'wrong_secret_key')
      .update(payload)
      .digest('hex');

    const isValid = provider.verifyWebhookSignature(tamperedSignature, payload);
    assert.strictEqual(isValid, false, 'Invalid HMAC signature must be rejected');
  });

  test('PaystackProvider rejects tampered body with valid signature', () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: testSecret,
    });

    const originalPayload = JSON.stringify({ amount: 2000000 });
    const tamperedPayload = JSON.stringify({ amount: 1000000 }); // attacker altered amount

    const signature = crypto
      .createHmac('sha512', testSecret)
      .update(originalPayload)
      .digest('hex');

    const isValid = provider.verifyWebhookSignature(signature, tamperedPayload);
    assert.strictEqual(isValid, false, 'Tampered payload must fail signature check');
  });
});
