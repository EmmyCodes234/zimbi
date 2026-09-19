import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { query } from '../src/db/connection.js';

describe('Vercel-Style Device Flow & Session Revocation (RFC 8628)', async () => {
  const app = buildApp();

  before(async () => {
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('POST /v1/auth/device/code requests device authorization code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/code',
      payload: {
        cliVersion: '0.1.0',
        nodeVersion: 'v20.11.1',
        platform: 'linux',
        arch: 'x64',
        location: 'Chelsea, New York City, NY',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(body.deviceCode.startsWith('dvc_'));
    assert.match(body.userCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(body.verificationUri, '/device');
    assert.equal(body.expiresIn, 600);
    assert.equal(body.interval, 2);
  });

  test('GET /device serves Vercel-style HTML verification page', async () => {
    const codeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/code',
      payload: {},
    });
    const { userCode } = JSON.parse(codeRes.payload);

    const pageRes = await app.inject({
      method: 'GET',
      url: `/device?code=${userCode}`,
    });

    assert.equal(pageRes.statusCode, 200);
    assert.match(pageRes.headers['content-type'] || '', /text\/html/);
    assert.ok(pageRes.payload.includes('Authorize Device'));
    assert.ok(pageRes.payload.includes(userCode.slice(0, 4)));
    assert.ok(pageRes.payload.includes(userCode.slice(5, 9)));
    assert.ok(pageRes.payload.includes('csrfToken'));
  });

  test('POST /v1/auth/device/verify rejects missing or invalid CSRF token', async () => {
    const codeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/code',
      payload: {},
    });
    const { userCode } = JSON.parse(codeRes.payload);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/verify',
      headers: { 'content-type': 'application/json' },
      payload: {
        userCode,
        email: 'developer@example.com',
        csrfToken: 'invalid-tampered-token',
      },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.match(body.error.message, /CSRF token/i);
  });

  test('POST /v1/auth/device/verify rejects missing developer email (authenticated session required)', async () => {
    const codeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/code',
      payload: {},
    });
    const { userCode } = JSON.parse(codeRes.payload);

    // Fetch CSRF token from page
    const pageRes = await app.inject({
      method: 'GET',
      url: `/device?code=${userCode}`,
    });
    const match = pageRes.payload.match(/name="csrfToken" value="([^"]+)"/);
    const csrfToken = match ? match[1] : '';

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/verify',
      headers: { 'content-type': 'application/json' },
      payload: {
        userCode,
        email: '',
        csrfToken,
      },
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.match(body.error.message, /developer email is required/i);
  });

  test('Complete flow: request -> pending poll -> authenticated browser approval -> single-use token exchange', async () => {
    // 1. CLI requests device code
    const codeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/code',
      payload: { location: 'Lagos, Nigeria' },
    });
    const { deviceCode, userCode } = JSON.parse(codeRes.payload);

    // 2. CLI polls immediately -> should return status: 'pending'
    const pollPending = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/token',
      payload: { deviceCode },
    });
    assert.equal(pollPending.statusCode, 200);
    assert.deepEqual(JSON.parse(pollPending.payload), { status: 'pending' });

    // 3. User visits browser page and gets CSRF token
    const pageRes = await app.inject({
      method: 'GET',
      url: `/device?code=${userCode}`,
    });
    const match = pageRes.payload.match(/name="csrfToken" value="([^"]+)"/);
    const csrfToken = match ? match[1] : '';

    // 4. User authenticates email and approves
    const devEmail = `dev_${Date.now()}@example.com`;
    const approveRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/verify',
      headers: { 'content-type': 'application/json' },
      payload: {
        userCode,
        email: devEmail,
        csrfToken,
      },
    });
    assert.equal(approveRes.statusCode, 200);
    const approveBody = JSON.parse(approveRes.payload);
    assert.equal(approveBody.success, true);
    assert.equal(approveBody.account.email, devEmail);

    // 5. CLI polls again -> single-use token exchange returns session token
    const pollApproved = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/token',
      payload: { deviceCode },
    });
    assert.equal(pollApproved.statusCode, 200);
    const tokenData = JSON.parse(pollApproved.payload);
    assert.equal(tokenData.status, 'approved');
    assert.ok(tokenData.sessionToken.startsWith('zmb_sess_'));
    assert.equal(tokenData.account.email, devEmail);

    // 6. Replay attack: CLI polls again with same device code -> rejected (status: denied, single-use consumed)
    const pollReplay = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/token',
      payload: { deviceCode },
    });
    assert.equal(pollReplay.statusCode, 400);
    const replayBody = JSON.parse(pollReplay.payload);
    assert.equal(replayBody.status, 'denied');
    assert.match(replayBody.error.message, /already consumed/i);

    // 7. Test /v1/auth/whoami with session token
    const whoamiRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/whoami',
      headers: { authorization: `Bearer ${tokenData.sessionToken}` },
    });
    assert.equal(whoamiRes.statusCode, 200);
    const whoami = JSON.parse(whoamiRes.payload);
    assert.equal(whoami.type, 'account');
    assert.equal(whoami.email, devEmail);

    // 8. Test /v1/auth/logout revokes session on server
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${tokenData.sessionToken}` },
    });
    assert.equal(logoutRes.statusCode, 200);
    assert.deepEqual(JSON.parse(logoutRes.payload), { loggedOut: true });

    // 9. Using revoked session token fails with 401
    const whoamiAfterRevoke = await app.inject({
      method: 'GET',
      url: '/v1/auth/whoami',
      headers: { authorization: `Bearer ${tokenData.sessionToken}` },
    });
    assert.equal(whoamiAfterRevoke.statusCode, 401);
  });

  test('Brute force lockout locks code after 5 invalid attempts', async () => {
    const codeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/code',
      payload: {},
    });
    const { userCode } = JSON.parse(codeRes.payload);

    // Simulate 5 attempts by incrementing attempt count
    await query(`UPDATE device_codes SET attempt_count = 5 WHERE user_code = $1`, [userCode]);

    // Check code details
    const pageRes = await app.inject({
      method: 'GET',
      url: `/device?code=${userCode}`,
    });
    assert.ok(pageRes.payload.includes('Too many invalid attempts'));
  });
});
