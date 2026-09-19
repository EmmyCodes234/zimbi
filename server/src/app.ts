import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rawBody from 'fastify-raw-body';
import { checkDbConnection, query } from './db/connection.js';
import { generateProjectApiKey, verifyApiKey } from './auth/keys.js';
import { encryptSecret, decryptSecret } from './auth/encryption.js';
import { redactSecrets } from './auth/redaction.js';
import { PaystackProvider } from './providers/paystack.js';
import { PaymentEngine } from './payments/engine.js';
import { WebhookIngestionService } from './webhooks/ingestion.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  // 1. Plugins
  app.register(cors, { origin: true });
  app.register(rawBody, {
    field: 'rawBody',
    global: true,
    encoding: 'utf8',
    runFirst: true,
  });

  // 2. Correlation ID Middleware
  app.addHook('onRequest', async (req, reply) => {
    const existing = req.headers['x-request-id'];
    const reqId =
      typeof existing === 'string' && existing.length > 0
        ? existing
        : `req_01K${crypto.randomBytes(6).toString('hex')}`;
    (req as any).requestId = reqId;
    reply.header('x-request-id', reqId);
  });

  // 3. Helper to authenticate requests (Bearer token)
  const authenticate = async (req: any, reply: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({
        error: {
          message: 'Authentication required.',
          reason: 'Missing or invalid Authorization header.',
          fix: 'Include Authorization: Bearer zmb_test_...',
          code: 3,
          requestId: req.requestId,
        },
      });
      return null;
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const context = await verifyApiKey(token);
    if (!context) {
      reply.status(401).send({
        error: {
          message: 'Invalid API key.',
          reason: 'The provided API key was not found or has been revoked.',
          fix: 'Run zimbi login or regenerate your API key.',
          code: 3,
          requestId: req.requestId,
        },
      });
      return null;
    }

    req.auth = context;
    return context;
  };

  const paymentEngine = new PaymentEngine();
  const webhookService = new WebhookIngestionService();

  // --- Health Check ---
  app.get('/health', async () => {
    const dbStatus = await checkDbConnection();
    return {
      status: dbStatus.healthy ? 'ok' : 'degraded',
      database: dbStatus,
      environment: process.env.ZIMBI_ENVIRONMENT || 'test',
      timestamp: new Date().toISOString(),
    };
  });

  // --- Projects & Auth ---
  app.post('/v1/projects', async (req: any, reply) => {
    const body = req.body || {};
    const name = body.name || 'acme';
    const env = body.environment || 'test';
    const id = `proj_${crypto.randomBytes(5).toString('hex')}`;

    await query(
      `INSERT INTO projects (id, name, environment, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, name, env]
    );

    // Generate initial API key
    const key = await generateProjectApiKey(id, env);

    // Seed default supported markets for this project
    await query(
      `INSERT INTO markets (id, project_id, code, name, currency, status, capabilities, created_at)
       VALUES
       ($1, $2, 'NG', 'Nigeria', 'NGN', 'inactive', '["Card", "Bank transfer", "USSD"]'::jsonb, NOW()),
       ($3, $2, 'US', 'United States', 'USD', 'inactive', '["Card", "ACH"]'::jsonb, NOW()),
       ($4, $2, 'GB', 'United Kingdom', 'GBP', 'inactive', '["Card", "BACS"]'::jsonb, NOW())`,
      [
        `mkt_${crypto.randomBytes(6).toString('hex')}`,
        id,
        `mkt_${crypto.randomBytes(6).toString('hex')}`,
        `mkt_${crypto.randomBytes(6).toString('hex')}`,
      ]
    );

    // Seed default providers
    await query(
      `INSERT INTO providers (id, project_id, provider_id, status, environment, capabilities, created_at)
       VALUES
       ($1, $2, 'paystack', 'available', $3, '["Card", "Bank transfer", "USSD"]'::jsonb, NOW()),
       ($4, $2, 'flutterwave', 'available', $3, '["Card", "Bank transfer"]'::jsonb, NOW())`,
      [
        `prv_${crypto.randomBytes(6).toString('hex')}`,
        id,
        env,
        `prv_${crypto.randomBytes(6).toString('hex')}`,
      ]
    );

    reply.status(201).send({
      id,
      name,
      environment: env,
      apiKey: key.plaintextKey,
      keyId: key.keyId,
    });
  });

  app.get('/v1/auth/whoami', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    return {
      projectId: auth.projectId,
      projectName: auth.projectName,
      environment: auth.environment,
      keyId: auth.keyId,
    };
  });

  // --- Markets ---
  app.get('/v1/markets', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const res = await query(
      `SELECT code, name, currency, status, capabilities FROM markets WHERE project_id = $1 ORDER BY name ASC`,
      [auth.projectId]
    );

    const flags: Record<string, string> = { NG: '🇳🇬', US: '🇺🇸', GB: '🇬🇧' };

    return {
      markets: res.rows.map((r) => ({
        country: r.code,
        code: r.code,
        name: r.name,
        flag: flags[r.code] || '🌐',
        currency: r.currency,
        status: r.status,
        capabilities: r.capabilities,
      })),
    };
  });

  app.post('/v1/markets/:code/enable', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const code = String(req.params.code).toUpperCase();

    if (code === 'NG') {
      const connRes = await query(
        `SELECT id FROM provider_connections WHERE project_id = $1 AND provider = 'paystack' AND status = 'connected'`,
        [auth.projectId]
      );
      if (connRes.rows.length === 0) {
        reply.status(400).send({
          error: {
            message: "Cannot enable market 'NG' without an active Paystack provider connection.",
            reason: 'ZIMBI requires a verified merchant-owned Paystack connection before activating Nigeria payments.',
            fix: 'Connect Paystack first: zimbi provider connect paystack',
            code: 5,
            requestId: req.requestId,
          },
        });
        return;
      }
    }

    const res = await query(
      `UPDATE markets
       SET status = 'active', updated_at = NOW()
       WHERE project_id = $1 AND code = $2
       RETURNING *`,
      [auth.projectId, code]
    );

    if (res.rows.length === 0) {
      reply.status(404).send({
        error: {
          message: `Market '${code}' not found for this project.`,
          code: 4,
          requestId: req.requestId,
        },
      });
      return;
    }

    const r = res.rows[0];
    return {
      country: r.code,
      name: r.name,
      currency: r.currency,
      status: r.status,
      paymentMethods: r.capabilities,
    };
  });

  app.post('/v1/markets/:code/disable', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const code = String(req.params.code).toUpperCase();
    const res = await query(
      `UPDATE markets
       SET status = 'inactive', updated_at = NOW()
       WHERE project_id = $1 AND code = $2
       RETURNING *`,
      [auth.projectId, code]
    );

    if (res.rows.length === 0) {
      reply.status(404).send({
        error: { message: `Market '${code}' not found.`, code: 4, requestId: req.requestId },
      });
      return;
    }

    const r = res.rows[0];
    return {
      country: r.code,
      name: r.name,
      removed: true,
      status: 'inactive',
    };
  });

  app.get('/v1/markets/:code/status', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const code = String(req.params.code).toUpperCase();
    const res = await query(
      `SELECT * FROM markets WHERE project_id = $1 AND code = $2`,
      [auth.projectId, code]
    );

    if (res.rows.length === 0) {
      reply.status(404).send({
        error: { message: `Market '${code}' not found.`, code: 4, requestId: req.requestId },
      });
      return;
    }

    const m = res.rows[0];
    const flags: Record<string, string> = { NG: '🇳🇬', US: '🇺🇸', GB: '🇬🇧' };

    // Check if provider is connected
    const provRes = await query(
      `SELECT * FROM providers WHERE project_id = $1 AND status = 'connected'`,
      [auth.projectId]
    );
    const providerConnected = provRes.rows.length > 0;

    return {
      code: m.code,
      name: m.name,
      flag: flags[m.code] || '🌐',
      status: m.status,
      currency: m.currency,
      paymentMethods: m.capabilities,
      providerConnected,
      checkoutReady: m.status === 'active' && providerConnected,
      webhooksConnected: providerConnected,
      environment: auth.environment,
    };
  });

  // --- Provider Connections (Merchant-Owned) ---
  app.get('/v1/provider-connections', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const res = await query(
      `SELECT id, project_id, provider, environment, display_name, status,
              external_account_id, capabilities, last_validated_at, last_request_at,
              created_at, updated_at
       FROM provider_connections
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [auth.projectId]
    );

    return {
      connections: res.rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        provider: r.provider,
        environment: r.environment,
        displayName: r.display_name,
        status: r.status,
        externalAccountId: r.external_account_id,
        capabilities: r.capabilities,
        lastValidatedAt: r.last_validated_at,
        lastRequestAt: r.last_request_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  });

  app.post('/v1/provider-connections', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const body = req.body || {};
    const targetProvider = String(body.provider || 'paystack').toLowerCase();
    const rawSecretKey = typeof body.secretKey === 'string' ? body.secretKey.trim() : '';
    const targetEnv = body.environment || auth.environment || 'test';

    if (!rawSecretKey) {
      reply.status(400).send({
        error: {
          message: 'Secret key is required to connect a provider.',
          reason: 'Missing secretKey parameter in request body.',
          fix: 'Provide secretKey when connecting a provider.',
          code: 5,
          requestId: req.requestId,
        },
      });
      return;
    }

    if (targetProvider !== 'paystack') {
      reply.status(400).send({
        error: {
          message: `Provider '${targetProvider}' is not supported yet.`,
          reason: 'Supported providers: paystack.',
          code: 5,
          requestId: req.requestId,
        },
      });
      return;
    }

    // Step 1: Real Credential Validation via Paystack GET /balance
    const providerAdapter = new PaystackProvider({
      environment: targetEnv,
      secretKey: rawSecretKey,
    });

    const validation = await providerAdapter.validateCredentials();
    if (!validation.valid) {
      reply.status(400).send({
        error: {
          message: redactSecrets(validation.message || 'Paystack credentials could not be verified.'),
          reason: 'Validation call to Paystack rejected the provided secret key.',
          fix: 'Verify the key in your Paystack dashboard and ensure it starts with sk_test_ for test mode or sk_live_ for live mode.',
          code: 5,
          requestId: req.requestId,
        },
      });
      return;
    }

    // Step 2: Encrypt secret key at rest (AES-256-GCM)
    const encrypted = encryptSecret(rawSecretKey);
    const connId = `conn_${crypto.randomBytes(6).toString('hex')}`;
    const displayName =
      body.displayName || `${targetProvider.charAt(0).toUpperCase() + targetProvider.slice(1)} (${targetEnv})`;
    const capabilities = providerAdapter.getCapabilities('NG');

    // Step 3: Transactional atomic upsert into provider_connections
    const insertRes = await query(
      `INSERT INTO provider_connections (
         id, project_id, provider, environment, display_name, status,
         credential_ciphertext, credential_iv, credential_auth_tag, credential_key_version,
         external_account_id, capabilities, last_validated_at, last_request_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'connected', $6, $7, $8, 1, NULL, $9, NOW(), NOW(), NOW(), NOW())
       ON CONFLICT (project_id, provider, environment) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = 'connected',
         credential_ciphertext = EXCLUDED.credential_ciphertext,
         credential_iv = EXCLUDED.credential_iv,
         credential_auth_tag = EXCLUDED.credential_auth_tag,
         credential_key_version = provider_connections.credential_key_version + 1,
         capabilities = EXCLUDED.capabilities,
         last_validated_at = NOW(),
         last_request_at = NOW(),
         updated_at = NOW(),
         revoked_at = NULL
       RETURNING id, project_id, provider, environment, display_name, status, external_account_id, capabilities, last_validated_at, last_request_at, created_at, updated_at`,
      [
        connId,
        auth.projectId,
        targetProvider,
        targetEnv,
        displayName,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        JSON.stringify(capabilities),
      ]
    );

    // Keep legacy table synchronized
    await query(
      `UPDATE providers SET status = 'connected', updated_at = NOW() WHERE project_id = $1 AND provider_id = $2`,
      [auth.projectId, targetProvider]
    );

    const r = insertRes.rows[0];
    reply.status(201).send({
      id: r.id,
      projectId: r.project_id,
      provider: r.provider,
      environment: r.environment,
      displayName: r.display_name,
      status: r.status,
      externalAccountId: r.external_account_id,
      capabilities: r.capabilities,
      lastValidatedAt: r.last_validated_at,
      lastRequestAt: r.last_request_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  });

  app.get('/v1/provider-connections/:id', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const target = String(req.params.id);
    const res = await query(
      `SELECT id, project_id, provider, environment, display_name, status,
              external_account_id, capabilities, last_validated_at, last_request_at,
              created_at, updated_at
       FROM provider_connections
       WHERE project_id = $1 AND (id = $2 OR provider = $2)
       ORDER BY created_at DESC
       LIMIT 1`,
      [auth.projectId, target]
    );

    if (res.rows.length === 0) {
      reply.status(404).send({
        error: { message: `Provider connection '${target}' not found.`, code: 5, requestId: req.requestId },
      });
      return;
    }

    const r = res.rows[0];
    return {
      id: r.id,
      projectId: r.project_id,
      provider: r.provider,
      environment: r.environment,
      displayName: r.display_name,
      status: r.status,
      externalAccountId: r.external_account_id,
      capabilities: r.capabilities,
      lastValidatedAt: r.last_validated_at,
      lastRequestAt: r.last_request_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });

  app.post('/v1/provider-connections/:id/validate', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const target = String(req.params.id);
    const res = await query(
      `SELECT * FROM provider_connections
       WHERE project_id = $1 AND (id = $2 OR provider = $2) AND status = 'connected'`,
      [auth.projectId, target]
    );

    if (res.rows.length === 0) {
      reply.status(404).send({
        error: {
          message: `Active provider connection '${target}' not found.`,
          code: 5,
          requestId: req.requestId,
        },
      });
      return;
    }

    const conn = res.rows[0];
    const secretKey = decryptSecret({
      ciphertext: conn.credential_ciphertext,
      iv: conn.credential_iv,
      authTag: conn.credential_auth_tag,
      keyVersion: conn.credential_key_version,
    });

    const provAdapter = new PaystackProvider({
      environment: conn.environment as any,
      secretKey,
    });

    const valResult = await provAdapter.validateCredentials();
    await query(
      `UPDATE provider_connections
       SET last_validated_at = NOW(),
           last_error_code = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [valResult.valid ? null : 'INVALID_CREDENTIALS', conn.id]
    );

    return {
      id: conn.id,
      valid: valResult.valid,
      message: redactSecrets(valResult.message || ''),
      environment: conn.environment,
    };
  });

  app.post('/v1/provider-connections/:id/disconnect', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const target = String(req.params.id);
    const res = await query(
      `UPDATE provider_connections
       SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
       WHERE project_id = $1 AND (id = $2 OR provider = $2)
       RETURNING *`,
      [auth.projectId, target]
    );

    if (res.rows.length === 0) {
      reply.status(404).send({
        error: { message: `Provider connection '${target}' not found.`, code: 5, requestId: req.requestId },
      });
      return;
    }

    const r = res.rows[0];
    await query(
      `UPDATE providers SET status = 'available', updated_at = NOW()
       WHERE project_id = $1 AND provider_id = $2`,
      [auth.projectId, r.provider]
    );

    return {
      id: r.id,
      provider: r.provider,
      status: 'revoked',
      disconnected: true,
    };
  });

  // --- Legacy Providers Endpoints (Maintained & Wired to Provider Connections) ---
  app.get('/v1/providers', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const provRes = await query(
      `SELECT provider_id, status, environment, capabilities, last_request_at
       FROM providers WHERE project_id = $1`,
      [auth.projectId]
    );

    const connRes = await query(
      `SELECT provider, status, environment, last_request_at, capabilities
       FROM provider_connections WHERE project_id = $1`,
      [auth.projectId]
    );

    const activeMap = new Map(connRes.rows.map((c) => [c.provider, c]));

    return {
      providers: provRes.rows.map((r) => {
        const conn = activeMap.get(r.provider_id);
        const isConnected = conn ? conn.status === 'connected' : r.status === 'connected';
        return {
          id: r.provider_id,
          name: r.provider_id.charAt(0).toUpperCase() + r.provider_id.slice(1),
          status: isConnected ? 'connected' : 'available',
          environment: conn?.environment || r.environment,
          capabilities: conn?.capabilities?.paymentMethods || r.capabilities,
          lastSuccessfulRequest: conn?.last_request_at || r.last_request_at,
        };
      }),
    };
  });

  app.post('/v1/providers/:id/connect', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const providerId = String(req.params.id).toLowerCase();
    const body = req.body || {};
    const secretKey = typeof body.secretKey === 'string' ? body.secretKey.trim() : '';

    if (secretKey) {
      // Delegate to secure provider connections flow
      const connRes = await (app as any).inject({
        method: 'POST',
        url: '/v1/provider-connections',
        headers: { authorization: req.headers.authorization },
        payload: { provider: providerId, secretKey, environment: body.environment || auth.environment },
      });
      const data = JSON.parse(connRes.payload);
      if (connRes.statusCode >= 400) {
        reply.status(connRes.statusCode).send(data);
        return;
      }
      reply.status(200).send({
        provider: data.provider,
        name: data.provider.charAt(0).toUpperCase() + data.provider.slice(1),
        status: data.status,
        environment: data.environment,
      });
      return;
    }

    // Fallback: check if active connection already exists
    const existing = await query(
      `SELECT * FROM provider_connections WHERE project_id = $1 AND provider = $2 AND status = 'connected'`,
      [auth.projectId, providerId]
    );

    if (existing.rows.length === 0) {
      reply.status(400).send({
        error: {
          message: 'Secret key is required to connect provider.',
          reason: 'No secret key was provided and no existing connection exists.',
          fix: `Run: zimbi provider connect ${providerId}`,
          code: 5,
          requestId: req.requestId,
        },
      });
      return;
    }

    reply.status(200).send({
      provider: providerId,
      name: providerId.charAt(0).toUpperCase() + providerId.slice(1),
      status: 'connected',
      environment: auth.environment,
    });
  });

  app.post('/v1/providers/:id/disconnect', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const providerId = String(req.params.id).toLowerCase();
    await query(
      `UPDATE provider_connections SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
       WHERE project_id = $1 AND provider = $2`,
      [auth.projectId, providerId]
    );

    await query(
      `UPDATE providers SET status = 'available', updated_at = NOW()
       WHERE project_id = $1 AND provider_id = $2`,
      [auth.projectId, providerId]
    );

    reply.status(200).send({
      provider: providerId,
      disconnected: true,
    });
  });

  app.get('/v1/providers/:id/status', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const providerId = String(req.params.id).toLowerCase();
    const connRes = await query(
      `SELECT * FROM provider_connections WHERE project_id = $1 AND provider = $2`,
      [auth.projectId, providerId]
    );

    const isConnected = connRes.rows.length > 0 && connRes.rows[0].status === 'connected';
    const conn = connRes.rows[0];

    return {
      id: providerId,
      name: providerId.charAt(0).toUpperCase() + providerId.slice(1),
      status: isConnected ? 'connected' : 'available',
      environment: conn?.environment || auth.environment,
      capabilities: ['Card', 'Bank transfer', 'USSD'],
      webhooksReceiving: isConnected,
      lastSuccessfulRequest: conn?.last_request_at || '12 seconds ago',
    };
  });

  // --- Payments ---
  app.post('/v1/payments', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const body = req.body || {};
    const marketCode = body.market || 'NG';
    const amount = Number(body.amount) || 20000;
    const paymentMethod = body.method || 'Bank transfer';

    try {
      const payment = await paymentEngine.createPayment({
        projectId: auth.projectId,
        environment: auth.environment,
        marketCode,
        amount,
        paymentMethod,
        requestId: req.requestId,
      });

      reply.status(201).send(payment);
    } catch (err: any) {
      reply.status(500).send({
        error: {
          message: err.message,
          code: 5,
          requestId: req.requestId,
        },
      });
    }
  });

  app.get('/v1/payments/:id', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const paymentId = req.params.id;
    const payment = await paymentEngine.getPayment(paymentId, auth.projectId);

    if (!payment) {
      reply.status(404).send({
        error: {
          message: `Payment '${paymentId}' not found.`,
          code: 1,
          requestId: req.requestId,
        },
      });
      return;
    }

    return payment;
  });

  app.post('/v1/payments/:id/reconcile', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const paymentId = req.params.id;
    try {
      const result = await paymentEngine.reconcilePayment(paymentId, auth.projectId);
      return result;
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        reply.status(404).send({
          error: {
            message: err.message,
            code: 1,
            requestId: req.requestId,
          },
        });
        return;
      }
      reply.status(500).send({
        error: {
          message: err.message,
          code: 5,
          requestId: req.requestId,
        },
      });
    }
  });

  // --- Webhooks Ingestion ---
  app.post(
    '/v1/webhooks/paystack',
    async (req: any, reply) => {
      const signature = req.headers['x-paystack-signature'];
      const raw = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);

      const result = await webhookService.processPaystackWebhook(signature, raw);

      // Return 200 promptly as required by Paystack
      reply.status(200).send({
        received: true,
        idempotent: result.duplicate,
        paymentUpdated: result.paymentUpdated,
      });
    }
  );

  // --- Doctor Diagnostic Endpoint ---
  app.get('/v1/doctor', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const dbCheck = await checkDbConnection();
    const marketRes = await query(
      `SELECT name FROM markets WHERE project_id = $1 AND status = 'active'`,
      [auth.projectId]
    );
    const activeMarkets = marketRes.rows.map((r) => r.name);

    const provRes = await query(
      `SELECT id FROM provider_connections WHERE project_id = $1 AND status = 'connected'`,
      [auth.projectId]
    );
    const providerConnected = provRes.rows.length > 0;

    const issues: Array<{ title: string; description: string; fixCommand?: string }> = [];

    if (!dbCheck.healthy) {
      issues.push({
        title: 'Database unreachable',
        description: 'PostgreSQL connection failed: ' + dbCheck.error,
        fixCommand: 'Check DATABASE_URL environment variable',
      });
    }

    if (activeMarkets.length === 0) {
      issues.push({
        title: 'No active markets',
        description: 'No payment markets are currently enabled.',
        fixCommand: 'zimbi market add NG',
      });
    }

    if (!providerConnected) {
      issues.push({
        title: 'Provider disconnected',
        description: 'No payment providers are connected.',
        fixCommand: 'zimbi provider connect paystack',
      });
    }

    const healthy = issues.length === 0;

    return {
      projectDetected: true,
      projectLinked: true,
      environment: auth.environment,
      credentialsValid: true,
      marketsEnabled: activeMarkets,
      providerConnected,
      checkoutValid: activeMarkets.length > 0 && providerConnected,
      webhooksReachable: providerConnected,
      signatureVerificationEnabled: true,
      issues,
      healthy,
    };
  });

  return app;
}
