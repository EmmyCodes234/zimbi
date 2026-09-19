import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { query } from '../src/db/connection.js';
import { createAccountSession, createOrGetAccount } from '../src/auth/sessions.js';
import { encryptSecret } from '../src/auth/encryption.js';

describe('Multi-Tenant Project Isolation Matrix', async () => {
  const app = buildApp();

  let accountA: { id: string; email: string };
  let sessionTokenA: string;
  let projectA: { id: string; apiKey: string };

  let accountB: { id: string; email: string };
  let sessionTokenB: string;
  let projectB: { id: string; apiKey: string };

  const secretKeyA = 'sk_test_mock_alpha_key_99999999999999';
  const secretKeyB = 'sk_test_mock_beta_key_88888888888888';

  let connAId: string;
  let connBId: string;

  let paymentA: any;
  let paymentB: any;

  before(async () => {
    await app.ready();

    // 1. Setup Account A and Project Alpha
    accountA = await createOrGetAccount(`alpha_${Date.now()}@example.com`, 'Alpha SaaS');
    const sessA = await createAccountSession(accountA.id);
    sessionTokenA = sessA.token;

    const projARes = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${sessionTokenA}` },
      payload: { name: 'Alpha Global SaaS', environment: 'test' },
    });
    assert.equal(projARes.statusCode, 201);
    projectA = JSON.parse(projARes.payload);

    // 2. Setup Account B and Project Beta
    accountB = await createOrGetAccount(`beta_${Date.now()}@example.com`, 'Beta SaaS');
    const sessB = await createAccountSession(accountB.id);
    sessionTokenB = sessB.token;

    const projBRes = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${sessionTokenB}` },
      payload: { name: 'Beta Global SaaS', environment: 'test' },
    });
    assert.equal(projBRes.statusCode, 201);
    projectB = JSON.parse(projBRes.payload);

    // 3. Connect mock Provider for Project A
    const encA = encryptSecret(secretKeyA);
    connAId = `conn_${crypto.randomBytes(6).toString('hex')}`;
    await query(
      `INSERT INTO provider_connections (
         id, project_id, provider, environment, display_name, status,
         credential_ciphertext, credential_iv, credential_auth_tag, credential_key_version,
         capabilities, created_at, updated_at
       ) VALUES ($1, $2, 'paystack', 'test', 'Paystack (test)', 'connected', $3, $4, $5, 1, '["Card", "Bank transfer"]'::jsonb, NOW(), NOW())`,
      [connAId, projectA.id, encA.ciphertext, encA.iv, encA.authTag]
    );

    // 4. Connect mock Provider for Project B
    const encB = encryptSecret(secretKeyB);
    connBId = `conn_${crypto.randomBytes(6).toString('hex')}`;
    await query(
      `INSERT INTO provider_connections (
         id, project_id, provider, environment, display_name, status,
         credential_ciphertext, credential_iv, credential_auth_tag, credential_key_version,
         capabilities, created_at, updated_at
       ) VALUES ($1, $2, 'paystack', 'test', 'Paystack (test)', 'connected', $3, $4, $5, 1, '["Card", "Bank transfer"]'::jsonb, NOW(), NOW())`,
      [connBId, projectB.id, encB.ciphertext, encB.iv, encB.authTag]
    );

    // Enable NG market for Project A only
    await app.inject({
      method: 'POST',
      url: '/v1/markets/NG/enable',
      headers: { authorization: `Bearer ${projectA.apiKey}` },
    });
  });

  after(async () => {
    await app.close();
  });

  test('1. Project Discovery Isolation: Session A only discovers Project A; Session B only discovers Project B', async () => {
    // Session A lists projects
    const resA = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${sessionTokenA}` },
    });
    assert.equal(resA.statusCode, 200);
    const bodyA = JSON.parse(resA.payload);
    assert.ok(bodyA.projects.some((p: any) => p.id === projectA.id));
    assert.ok(!bodyA.projects.some((p: any) => p.id === projectB.id));

    // Session B lists projects
    const resB = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${sessionTokenB}` },
    });
    assert.equal(resB.statusCode, 200);
    const bodyB = JSON.parse(resB.payload);
    assert.ok(bodyB.projects.some((p: any) => p.id === projectB.id));
    assert.ok(!bodyB.projects.some((p: any) => p.id === projectA.id));

    // Project API Key cannot list projects (returns 403)
    const resProjKey = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${projectA.apiKey}` },
    });
    assert.equal(resProjKey.statusCode, 403);
  });

  test('2. Market Isolation: Project A has NG active; Project B has NG inactive', async () => {
    const resA = await app.inject({
      method: 'GET',
      url: '/v1/markets/NG/status',
      headers: { authorization: `Bearer ${projectA.apiKey}` },
    });
    assert.equal(resA.statusCode, 200);
    assert.equal(JSON.parse(resA.payload).status, 'active');

    const resB = await app.inject({
      method: 'GET',
      url: '/v1/markets/NG/status',
      headers: { authorization: `Bearer ${projectB.apiKey}` },
    });
    assert.equal(resB.statusCode, 200);
    assert.equal(JSON.parse(resB.payload).status, 'inactive');
  });

  test('3. Provider Connection Cross-Tenant Attack: Project A cannot inspect or disconnect Project B connection', async () => {
    // Project A inspects connection B -> 404
    const resInspect = await app.inject({
      method: 'GET',
      url: `/v1/provider-connections/${connBId}`,
      headers: { authorization: `Bearer ${projectA.apiKey}` },
    });
    assert.equal(resInspect.statusCode, 404);

    // Project A disconnects connection B -> 404
    const resDisconnect = await app.inject({
      method: 'POST',
      url: `/v1/provider-connections/${connBId}/disconnect`,
      headers: { authorization: `Bearer ${projectA.apiKey}` },
    });
    assert.equal(resDisconnect.statusCode, 404);

    // Verify connection B is still connected
    const checkB = await query(`SELECT status FROM provider_connections WHERE id = $1`, [connBId]);
    assert.equal(checkB.rows[0].status, 'connected');
  });

  test('4. Payment Creation & Immutable Reference: Generates zmb_ref_${paymentId} and enforces database immutability', async () => {
    // Project A creates payment
    const resPayA = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: { authorization: `Bearer ${projectA.apiKey}` },
      payload: { market: 'NG', amount: 25000, method: 'Bank transfer' },
    });
    assert.equal(resPayA.statusCode, 201);
    paymentA = JSON.parse(resPayA.payload);
    assert.equal(paymentA.providerReference, `zmb_ref_${paymentA.id}`);

    // Enable NG for Project B and create payment B
    await app.inject({
      method: 'POST',
      url: '/v1/markets/NG/enable',
      headers: { authorization: `Bearer ${projectB.apiKey}` },
    });
    const resPayB = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: { authorization: `Bearer ${projectB.apiKey}` },
      payload: { market: 'NG', amount: 50000, method: 'Card' },
    });
    assert.equal(resPayB.statusCode, 201);
    paymentB = JSON.parse(resPayB.payload);
    assert.equal(paymentB.providerReference, `zmb_ref_${paymentB.id}`);

    // Database Immutability Trigger Test:
    // Attempting to mutate provider_reference directly in Postgres MUST raise an exception
    await assert.rejects(
      async () => {
        await query(
          `UPDATE payments SET provider_reference = 'zmb_ref_mutated_illegal' WHERE id = $1`,
          [paymentA.id]
        );
      },
      (err: any) => {
        return err.message.includes('payments.provider_reference is immutable once set');
      }
    );
  });

  test('5. Cross-Tenant Inspection Attack: Project A cannot read Project B payment (404 Non-Disclosing)', async () => {
    // Project A attempts to read Payment B
    const res = await app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentB.id}`,
      headers: { authorization: `Bearer ${projectA.apiKey}` },
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.payload);
    assert.equal(body.error.message, `Payment '${paymentB.id}' not found.`);

    // Project B attempts to read Payment A
    const resReverse = await app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentA.id}`,
      headers: { authorization: `Bearer ${projectB.apiKey}` },
    });
    assert.equal(resReverse.statusCode, 404);
  });

  test('6. Cross-Tenant Reconciliation Attack: Project A cannot reconcile Project B payment (404 Non-Disclosing)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentB.id}/reconcile`,
      headers: { authorization: `Bearer ${projectA.apiKey}` },
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.payload);
    assert.match(body.error.message, /not found/i);
  });

  test('7. Webhook Cross-Tenant Routing & Rejection: Webhook signed with Secret B fails signature for Payment A', async () => {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 12345,
        reference: paymentA.providerReference,
        amount: 2500000,
        currency: 'NGN',
        status: 'success',
      },
    });

    // Sign with Project B's secret key (wrong tenant secret!)
    const invalidSignature = crypto
      .createHmac('sha512', secretKeyB)
      .update(payload)
      .digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/paystack',
      headers: {
        'x-paystack-signature': invalidSignature,
        'content-type': 'application/json',
      },
      payload,
    });

    assert.equal(res.statusCode, 200);
    const resData = JSON.parse(res.payload);
    assert.equal(resData.paymentUpdated, false);

    // Verify Payment A was NOT modified
    const checkPayment = await query(`SELECT status FROM payments WHERE id = $1`, [paymentA.id]);
    assert.equal(checkPayment.rows[0].status, 'pending');

    // Now sign with Project A's valid secret key
    const validSignature = crypto
      .createHmac('sha512', secretKeyA)
      .update(payload)
      .digest('hex');

    const validRes = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/paystack',
      headers: {
        'x-paystack-signature': validSignature,
        'content-type': 'application/json',
      },
      payload,
    });

    assert.equal(validRes.statusCode, 200);
    const validResData = JSON.parse(validRes.payload);
    assert.equal(validResData.paymentUpdated, true);

    // Verify Payment A is now succeeded and Payment B remains pending
    const checkPaymentAAfter = await query(`SELECT status FROM payments WHERE id = $1`, [paymentA.id]);
    assert.equal(checkPaymentAAfter.rows[0].status, 'succeeded');

    const checkPaymentBAfter = await query(`SELECT status FROM payments WHERE id = $1`, [paymentB.id]);
    assert.equal(checkPaymentBAfter.rows[0].status, 'pending');
  });

  test('8. Doctor Diagnostic Scoping: Project A doctor only reports Project A state', async () => {
    const docA = await app.inject({
      method: 'GET',
      url: '/v1/doctor',
      headers: { authorization: `Bearer ${projectA.apiKey}` },
    });
    assert.equal(docA.statusCode, 200);
    const bodyA = JSON.parse(docA.payload);
    assert.equal(bodyA.providerConnected, true);
    assert.deepEqual(bodyA.marketsEnabled, ['Nigeria']);
  });
});
