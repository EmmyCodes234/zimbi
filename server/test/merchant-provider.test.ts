import { test, describe } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { PaystackProvider } from '../src/providers/paystack.js';
import { PaymentEngine } from '../src/payments/engine.js';
import { WebhookIngestionService } from '../src/webhooks/ingestion.js';
import { encryptSecret } from '../src/auth/encryption.js';
import { query } from '../src/db/connection.js';

describe('Merchant-Owned Provider Connections & Golden Rule', () => {
  const validMockKey = 'sk_test_mock_secret_key_12345';
  const invalidMockKey = 'sk_test_invalid_mock_key';

  describe('PaystackProvider validation & capabilities', () => {
    test('validateCredentials accepts valid mock test key', async () => {
      const provider = new PaystackProvider({
        environment: 'test',
        secretKey: validMockKey,
      });
      const res = await provider.validateCredentials();
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.provider, 'paystack');
      assert.strictEqual(res.environment, 'test');
    });

    test('validateCredentials rejects mock invalid key', async () => {
      const provider = new PaystackProvider({
        environment: 'test',
        secretKey: invalidMockKey,
      });
      const res = await provider.validateCredentials();
      assert.strictEqual(res.valid, false);
      assert.ok(res.message?.includes('Invalid Paystack secret key'));
    });

    test('validateCredentials enforces key prefix matching environment', async () => {
      // Test mode with sk_live_ key
      const liveKeyInTest = new PaystackProvider({
        environment: 'test',
        secretKey: 'sk_live_1234567890abcdef',
      });
      const resTest = await liveKeyInTest.validateCredentials();
      assert.strictEqual(resTest.valid, false);
      assert.ok(resTest.message?.includes('Invalid key prefix'));

      // Live mode with sk_test_ key
      const testKeyInLive = new PaystackProvider({
        environment: 'production',
        secretKey: 'sk_test_1234567890abcdef',
      });
      const resLive = await testKeyInLive.validateCredentials();
      assert.strictEqual(resLive.valid, false);
      assert.ok(resLive.message?.includes('Invalid key prefix'));
    });

    test('validateCredentials rejects empty key', async () => {
      const provider = new PaystackProvider({
        environment: 'test',
        secretKey: '',
      });
      const res = await provider.validateCredentials();
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.message, 'No secret key provided.');
    });

    test('getCapabilities returns decoupled capabilities for NG', () => {
      const provider = new PaystackProvider({
        environment: 'test',
        secretKey: validMockKey,
      });
      const caps = provider.getCapabilities('NG');
      assert.strictEqual(caps.provider, 'paystack');
      assert.strictEqual(caps.market, 'NG');
      assert.deepStrictEqual(caps.currencies, ['NGN']);
      assert.deepStrictEqual(caps.paymentMethods, ['card', 'bank_transfer', 'ussd']);
      assert.ok(caps.features.includes('webhooks'));
    });
  });

  describe('Golden Rule Enforcement: No Connection = No Payment', () => {
    const testProjectId = `proj_test_${crypto.randomBytes(4).toString('hex')}`;

    test('rejection when merchant has not connected Paystack', async () => {
      // Create project with no provider connection
      await query(
        `INSERT INTO projects (id, name, environment, created_at, updated_at)
         VALUES ($1, 'Acme Test', 'test', NOW(), NOW())`,
        [testProjectId]
      );

      await query(
        `INSERT INTO markets (id, project_id, code, name, currency, status, capabilities, created_at)
         VALUES ($1, $2, 'NG', 'Nigeria', 'NGN', 'active', '["Card", "Bank transfer", "USSD"]'::jsonb, NOW())`,
        [`mkt_${crypto.randomBytes(4).toString('hex')}`, testProjectId]
      );

      const engine = new PaymentEngine();
      await assert.rejects(
        async () => {
          await engine.createPayment({
            projectId: testProjectId,
            environment: 'test',
            marketCode: 'NG',
            amount: 20000,
            paymentMethod: 'Bank transfer',
          });
        },
        (err: any) => {
          assert.ok(err.message.includes('ZIMBI needs an active Paystack connection for this project'));
          assert.ok(err.message.includes('zimbi provider connect paystack'));
          return true;
        }
      );
    });

    test('payment succeeds and stores provider_connection_id once merchant connects', async () => {
      const connId = `conn_${crypto.randomBytes(6).toString('hex')}`;
      const encrypted = encryptSecret(validMockKey);

      await query(
        `INSERT INTO provider_connections (
           id, project_id, provider, environment, display_name, status,
           credential_ciphertext, credential_iv, credential_auth_tag, credential_key_version,
           capabilities, last_validated_at, last_request_at, created_at, updated_at
         ) VALUES ($1, $2, 'paystack', 'test', 'Paystack (test)', 'connected', $3, $4, $5, 1, '["card", "bank_transfer", "ussd"]'::jsonb, NOW(), NOW(), NOW(), NOW())`,
        [connId, testProjectId, encrypted.ciphertext, encrypted.iv, encrypted.authTag]
      );

      const engine = new PaymentEngine();
      const payment = await engine.createPayment({
        projectId: testProjectId,
        environment: 'test',
        marketCode: 'NG',
        amount: 20000,
        paymentMethod: 'Bank transfer',
      });

      assert.ok(payment.id.startsWith('pay_test_'));
      assert.strictEqual(payment.status, 'pending');
      assert.strictEqual(payment.provider, 'Paystack');
      assert.strictEqual(payment.providerConnectionId, connId);
      assert.ok(payment.authorizationUrl);

      // Verify row in database
      const dbRow = await query(`SELECT * FROM payments WHERE id = $1`, [payment.id]);
      assert.strictEqual(dbRow.rows.length, 1);
      assert.strictEqual(dbRow.rows[0].provider_connection_id, connId);
    });
  });

  describe('Signature-First Webhook Security', () => {
    const webhookProjectId = `proj_wh_${crypto.randomBytes(4).toString('hex')}`;
    const connId = `conn_wh_${crypto.randomBytes(6).toString('hex')}`;
    const webhookSecret = 'sk_test_mock_secret_key_12345';
    let paymentId: string;
    let paymentRef: string;

    test('setup merchant payment for webhook test', async () => {
      const encrypted = encryptSecret(webhookSecret);
      await query(
        `INSERT INTO projects (id, name, environment, created_at, updated_at)
         VALUES ($1, 'Acme Webhook', 'test', NOW(), NOW())`,
        [webhookProjectId]
      );
      await query(
        `INSERT INTO markets (id, project_id, code, name, currency, status, capabilities, created_at)
         VALUES ($1, $2, 'NG', 'Nigeria', 'NGN', 'active', '["Card", "Bank transfer", "USSD"]'::jsonb, NOW())`,
        [`mkt_${crypto.randomBytes(4).toString('hex')}`, webhookProjectId]
      );
      await query(
        `INSERT INTO provider_connections (
           id, project_id, provider, environment, display_name, status,
           credential_ciphertext, credential_iv, credential_auth_tag, credential_key_version,
           capabilities, last_validated_at, last_request_at, created_at, updated_at
         ) VALUES ($1, $2, 'paystack', 'test', 'Paystack (test)', 'connected', $3, $4, $5, 1, '["card", "bank_transfer", "ussd"]'::jsonb, NOW(), NOW(), NOW(), NOW())`,
        [connId, webhookProjectId, encrypted.ciphertext, encrypted.iv, encrypted.authTag]
      );

      const engine = new PaymentEngine();
      const payment = await engine.createPayment({
        projectId: webhookProjectId,
        environment: 'test',
        marketCode: 'NG',
        amount: 25000,
        paymentMethod: 'Card',
      });
      paymentId = payment.id;
      paymentRef = payment.providerReference!;
      assert.ok(paymentId);
      assert.ok(paymentRef);
    });

    test('invalid signature is rejected prior to state change', async () => {
      const service = new WebhookIngestionService();
      const payload = JSON.stringify({
        event: 'charge.success',
        data: {
          id: 998877,
          reference: paymentRef,
          amount: 2500000,
          currency: 'NGN',
          status: 'success',
        },
      });

      const invalidSig = crypto
        .createHmac('sha512', 'attacker_wrong_key')
        .update(payload)
        .digest('hex');

      const result = await service.processPaystackWebhook(invalidSig, payload);
      assert.strictEqual(result.accepted, false);
      assert.strictEqual(result.signatureVerified, false);
      assert.strictEqual(result.paymentUpdated, false);
      assert.ok(result.error?.includes('Invalid webhook signature'));

      // Confirm payment state in DB is STILL pending
      const payRes = await query(`SELECT status FROM payments WHERE id = $1`, [paymentId]);
      assert.strictEqual(payRes.rows[0].status, 'pending');
    });

    test('valid HMAC-SHA512 transitions payment from pending to succeeded', async () => {
      const service = new WebhookIngestionService();
      const payload = JSON.stringify({
        event: 'charge.success',
        data: {
          id: 998877,
          reference: paymentRef,
          amount: 2500000,
          currency: 'NGN',
          status: 'success',
        },
      });

      const validSig = crypto
        .createHmac('sha512', webhookSecret)
        .update(payload)
        .digest('hex');

      const result = await service.processPaystackWebhook(validSig, payload);
      assert.strictEqual(result.accepted, true);
      assert.strictEqual(result.signatureVerified, true);
      assert.strictEqual(result.paymentUpdated, true);

      // Confirm payment state in DB is succeeded
      const payRes = await query(`SELECT status FROM payments WHERE id = $1`, [paymentId]);
      assert.strictEqual(payRes.rows[0].status, 'succeeded');
    });

    test('duplicate valid webhook is deduplicated idempotently', async () => {
      const service = new WebhookIngestionService();
      const payload = JSON.stringify({
        event: 'charge.success',
        data: {
          id: 998877,
          reference: paymentRef,
          amount: 2500000,
          currency: 'NGN',
          status: 'success',
        },
      });

      const validSig = crypto
        .createHmac('sha512', webhookSecret)
        .update(payload)
        .digest('hex');

      const result = await service.processPaystackWebhook(validSig, payload);
      assert.strictEqual(result.accepted, true);
      assert.strictEqual(result.duplicate, true);
      assert.strictEqual(result.paymentUpdated, false);
    });
  });
});
