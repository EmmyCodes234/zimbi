import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PaystackProvider } from '../src/providers/paystack.js';

describe('ZIMBI Provider Verification & Reconciliation Path', () => {
  test('PaystackProvider returns structured verification for mock reference', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: 'sk_test_demo_key_placeholder',
    });

    const result = await provider.verifyTransaction('pay_test_ABC_ref');
    assert.strictEqual(result.status, 'succeeded');
    assert.strictEqual(result.reference, 'pay_test_ABC_ref');
    assert.strictEqual(result.currency, 'NGN');
    assert.strictEqual(result.amountMinor, 2000000);
  });

  test('PaystackProvider handles simulated failures in test mode', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: 'sk_test_demo_key_placeholder',
    });

    const result = await provider.verifyTransaction('pay_test_mock_fail_ref');
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.gatewayResponse, 'Declined by issuer');
  });

  test('PaystackProvider handles simulated abandoned checkout in test mode', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: 'sk_test_demo_key_placeholder',
    });

    const result = await provider.verifyTransaction('pay_test_mock_abandoned_ref');
    assert.strictEqual(result.status, 'abandoned');
    assert.strictEqual(result.gatewayResponse, 'Customer abandoned transaction');
  });

  test('verifyTransaction throws when reference is empty', async () => {
    const provider = new PaystackProvider({
      environment: 'test',
      secretKey: 'sk_test_demo_key_placeholder',
    });

    await assert.rejects(
      async () => await provider.verifyTransaction(''),
      /Transaction reference is required/
    );
  });
});
