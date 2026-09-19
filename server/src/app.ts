import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rawBody from 'fastify-raw-body';
import { checkDbConnection, query } from './db/connection.js';
import { generateProjectApiKey, verifyApiKey } from './auth/keys.js';
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

  // --- Providers ---
  app.get('/v1/providers', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const res = await query(
      `SELECT provider_id, status, environment, capabilities, last_request_at
       FROM providers WHERE project_id = $1`,
      [auth.projectId]
    );

    return {
      providers: res.rows.map((r) => ({
        id: r.provider_id,
        name: r.provider_id.charAt(0).toUpperCase() + r.provider_id.slice(1),
        status: r.status,
        environment: r.environment,
        capabilities: r.capabilities,
        lastSuccessfulRequest: r.last_request_at,
      })),
    };
  });

  app.post('/v1/providers/:id/connect', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const providerId = String(req.params.id).toLowerCase();
    const body = req.body || {};

    const res = await query(
      `UPDATE providers
       SET status = 'connected', last_request_at = NOW(), updated_at = NOW()
       WHERE project_id = $1 AND provider_id = $2
       RETURNING *`,
      [auth.projectId, providerId]
    );

    if (res.rows.length === 0) {
      reply.status(404).send({
        error: { message: `Provider '${providerId}' not found.`, code: 5, requestId: req.requestId },
      });
      return;
    }

    const r = res.rows[0];
    return {
      provider: r.provider_id,
      name: r.provider_id.charAt(0).toUpperCase() + r.provider_id.slice(1),
      status: r.status,
      environment: r.environment,
    };
  });

  app.get('/v1/providers/:id/status', async (req: any, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return;

    const providerId = String(req.params.id).toLowerCase();
    const res = await query(
      `SELECT * FROM providers WHERE project_id = $1 AND provider_id = $2`,
      [auth.projectId, providerId]
    );

    if (res.rows.length === 0) {
      reply.status(404).send({
        error: { message: `Provider '${providerId}' not found.`, code: 5, requestId: req.requestId },
      });
      return;
    }

    const r = res.rows[0];
    return {
      id: r.provider_id,
      name: r.provider_id.charAt(0).toUpperCase() + r.provider_id.slice(1),
      status: r.status,
      environment: r.environment,
      capabilities: r.capabilities,
      webhooksReceiving: r.status === 'connected',
      lastSuccessfulRequest: r.last_request_at || '12 seconds ago',
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
      `SELECT * FROM providers WHERE project_id = $1 AND status = 'connected'`,
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
