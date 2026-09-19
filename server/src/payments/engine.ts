import crypto from 'node:crypto';
import { query } from '../db/connection.js';
import { PaystackProvider } from '../providers/paystack.js';
import { decryptSecret } from '../auth/encryption.js';
import {
  canTransition,
  assertValidTransition,
  PaymentStatus,
} from './stateMachine.js';

export interface CreatePaymentInput {
  projectId: string;
  environment: 'test' | 'production';
  marketCode: string;
  amount: number; // in major units e.g. 20000 for ₦20,000
  paymentMethod: string; // 'Bank transfer' | 'Card' | 'USSD'
  customerEmail?: string;
  requestId?: string;
}

export interface PaymentDetails {
  id: string;
  projectId: string;
  marketCode: string;
  amount: number;
  formattedAmount: string;
  currency: string;
  paymentMethod: string;
  status: PaymentStatus;
  provider: string;
  providerReference?: string;
  providerConnectionId?: string;
  authorizationUrl?: string;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
  webhookEvents?: Array<{
    eventType: string;
    receivedAt: string;
    signatureVerified: boolean;
    status: string;
  }>;
}

export interface ReconciliationResult {
  paymentId: string;
  provider: string;
  providerReference?: string;
  localStatus: PaymentStatus;
  providerStatus: string;
  inSync: boolean;
  discrepancyDetected: boolean;
  actionTaken: 'none' | 'updated_to_succeeded' | 'updated_to_failed' | 'updated_to_expired';
  message: string;
  updatedAt: string;
}

export function generatePaymentId(environment: 'test' | 'production'): string {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return environment === 'production' ? `pay_live_${rand}` : `pay_test_${rand}`;
}

export class PaymentEngine {
  async createPayment(input: CreatePaymentInput): Promise<PaymentDetails> {
    const marketUpper = input.marketCode.toUpperCase();
    const environment = input.environment;
    const paymentId = generatePaymentId(environment);
    const requestId = input.requestId || `req_01K${crypto.randomBytes(6).toString('hex')}`;
    const email = input.customerEmail || `customer+${paymentId}@example.com`;

    // 1. Check market in DB
    const marketRes = await query(
      `SELECT * FROM markets WHERE project_id = $1 AND code = $2`,
      [input.projectId, marketUpper]
    );

    const currency = marketRes.rows.length > 0 ? marketRes.rows[0].currency : 'NGN';
    const amountMinor = Math.round(input.amount * 100); // ₦20,000 -> 2,000,000 kobo

    // 2. Resolve merchant-owned provider connection
    // GOLDEN RULE: NO MERCHANT CONNECTION = NO MERCHANT PAYMENT.
    const connRes = await query(
      `SELECT id, provider, environment, credential_ciphertext, credential_iv, credential_auth_tag, credential_key_version, status
       FROM provider_connections
       WHERE project_id = $1 AND provider = 'paystack' AND environment = $2 AND status = 'connected'`,
      [input.projectId, environment]
    );

    if (connRes.rows.length === 0) {
      throw new Error(
        `ZIMBI needs an active Paystack connection for this project in ${environment} mode. ` +
        `A merchant-owned provider connection is required before creating payments. Run: zimbi provider connect paystack`
      );
    }

    const connection = connRes.rows[0];

    // Decrypt merchant credential in memory
    const secretKey = decryptSecret({
      ciphertext: connection.credential_ciphertext,
      iv: connection.credential_iv,
      authTag: connection.credential_auth_tag,
      keyVersion: connection.credential_key_version,
    });

    // 3. Select channel
    const channelMap: Record<string, string> = {
      'Card': 'card',
      'Bank transfer': 'bank_transfer',
      'USSD': 'ussd',
    };
    const channels = [channelMap[input.paymentMethod] || 'card'];

    // 4. Instantiate provider with merchant-owned secret key
    const provider = new PaystackProvider({ environment, secretKey });

    // Hard Invariant: ONE ZIMBI PAYMENT -> ONE IMMUTABLE ZIMBI PROVIDER REFERENCE
    const reference = `zmb_ref_${paymentId}`;

    // 5. Initialize transaction with Paystack API
    const trxResult = await provider.initializeTransaction({
      amountMinor,
      currency,
      email,
      reference,
      channels,
      metadata: {
        paymentId,
        projectId: input.projectId,
        providerConnectionId: connection.id,
        environment,
      },
    });

    // 6. Insert payment row into PostgreSQL with provider_connection_id and immutable reference
    await query(
      `INSERT INTO payments (
        id, project_id, market_code, amount_minor, currency, payment_method,
        status, provider_id, provider_connection_id, provider_reference, authorization_url, request_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [
        paymentId,
        input.projectId,
        marketUpper,
        amountMinor,
        currency,
        input.paymentMethod,
        'pending',
        'paystack',
        connection.id,
        trxResult.providerReference || reference,
        trxResult.authorizationUrl,
        requestId,
      ]
    );

    // Update connection last_request_at
    await query(
      `UPDATE provider_connections SET last_request_at = NOW() WHERE id = $1`,
      [connection.id]
    );

    const formattedAmount =
      currency === 'NGN'
        ? `₦${input.amount.toLocaleString()}`
        : `${currency} ${input.amount.toLocaleString()}`;

    return {
      id: paymentId,
      projectId: input.projectId,
      marketCode: marketUpper,
      amount: input.amount,
      formattedAmount,
      currency,
      paymentMethod: input.paymentMethod,
      status: 'pending',
      provider: 'Paystack',
      providerReference: trxResult.providerReference || reference,
      providerConnectionId: connection.id,
      authorizationUrl: trxResult.authorizationUrl,
      requestId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getPayment(paymentId: string, projectId: string): Promise<PaymentDetails | null> {
    const res = await query(
      `SELECT * FROM payments WHERE id = $1 AND project_id = $2`,
      [paymentId, projectId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    const amountMajor = Number(row.amount_minor) / 100;
    const formattedAmount =
      row.currency === 'NGN'
        ? `₦${amountMajor.toLocaleString()}`
        : `${row.currency} ${amountMajor.toLocaleString()}`;

    // Get correlated webhook events strictly scoped by project
    let webhookEvents: PaymentDetails['webhookEvents'] = [];
    if (row.provider_reference) {
      const whRes = await query(
        `SELECT event_type, received_at, signature_verified, processing_status
         FROM webhook_events
         WHERE project_id = $1 AND (payment_id = $2 OR provider_transaction_id = $3)
         ORDER BY received_at ASC`,
        [projectId, row.id, row.provider_reference]
      );
      webhookEvents = whRes.rows.map((r: any) => ({
        eventType: r.event_type,
        receivedAt: r.received_at,
        signatureVerified: r.signature_verified,
        status: r.processing_status,
      }));
    }

    return {
      id: row.id,
      projectId: row.project_id,
      marketCode: row.market_code,
      amount: amountMajor,
      formattedAmount,
      currency: row.currency,
      paymentMethod: row.payment_method,
      status: row.status as PaymentStatus,
      provider: 'Paystack',
      providerReference: row.provider_reference,
      providerConnectionId: row.provider_connection_id || undefined,
      authorizationUrl: row.authorization_url,
      requestId: row.request_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      webhookEvents,
    };
  }

  /**
   * Reconciles local payment state with the payment provider.
   * STRICT ORDERING:
   * 1. Authenticate project
   * 2. Authorize ownership (WHERE id = $1 AND project_id = $2)
   * 3. Decrypt credential in memory only after ownership confirmed
   * 4. Call provider API
   */
  async reconcilePayment(paymentId: string, projectId: string): Promise<ReconciliationResult> {
    // 1. Ownership check: Must belong strictly to the authenticated project
    const res = await query(
      `SELECT * FROM payments WHERE id = $1 AND project_id = $2`,
      [paymentId, projectId]
    );

    if (res.rows.length === 0) {
      throw new Error(`Payment '${paymentId}' not found`);
    }

    const row = res.rows[0];
    const localStatus = row.status as PaymentStatus;
    const providerId = row.provider_id || 'paystack';
    const reference = row.provider_reference;

    if (!reference) {
      return {
        paymentId,
        provider: providerId,
        localStatus,
        providerStatus: 'none',
        inSync: true,
        discrepancyDetected: false,
        actionTaken: 'none',
        message: 'No provider reference attached to payment.',
        updatedAt: row.updated_at,
      };
    }

    // 2. Resolve merchant secret key for verification from owning connection
    let secretKey = '';
    if (row.provider_connection_id) {
      const connRes = await query(
        `SELECT credential_ciphertext, credential_iv, credential_auth_tag, credential_key_version
         FROM provider_connections WHERE id = $1 AND project_id = $2`,
        [row.provider_connection_id, projectId]
      );
      if (connRes.rows.length > 0) {
        const conn = connRes.rows[0];
        secretKey = decryptSecret({
          ciphertext: conn.credential_ciphertext,
          iv: conn.credential_iv,
          authTag: conn.credential_auth_tag,
          keyVersion: conn.credential_key_version,
        });
      }
    } else {
      const connRes = await query(
        `SELECT credential_ciphertext, credential_iv, credential_auth_tag, credential_key_version
         FROM provider_connections WHERE project_id = $1 AND provider = 'paystack' AND status = 'connected'`,
        [projectId]
      );
      if (connRes.rows.length > 0) {
        const conn = connRes.rows[0];
        secretKey = decryptSecret({
          ciphertext: conn.credential_ciphertext,
          iv: conn.credential_iv,
          authTag: conn.credential_auth_tag,
          keyVersion: conn.credential_key_version,
        });
      }
    }

    if (!secretKey) {
      throw new Error(`No active provider connection found for payment '${paymentId}' to reconcile.`);
    }

    // 3. Provider check with decrypted merchant key
    const env = row.id.startsWith('pay_live_') ? 'production' : 'test';
    const provider = new PaystackProvider({ environment: env, secretKey });
    const verification = await provider.verifyTransaction(reference);

    const providerStatus = verification.status;
    let discrepancyDetected = false;
    let inSync = false;
    let actionTaken: ReconciliationResult['actionTaken'] = 'none';
    let message = 'Payment state is consistent with provider.';

    if (localStatus === 'succeeded') {
      if (providerStatus === 'succeeded') {
        inSync = true;
        message = 'Payment is in sync (both local and provider confirmed succeeded).';
      } else {
        discrepancyDetected = true;
        inSync = false;
        message = `Critical discrepancy: Local payment is succeeded, but provider reports ${providerStatus}. State preserved.`;
      }
    } else if (localStatus === 'pending' || localStatus === 'processing') {
      if (providerStatus === 'succeeded') {
        discrepancyDetected = true;
        inSync = false;

        // Zero-Trust verification before updating state
        const amountMatches = Number(row.amount_minor) === verification.amountMinor;
        const currencyMatches = row.currency.toUpperCase() === verification.currency.toUpperCase();

        if (amountMatches && currencyMatches) {
          assertValidTransition(localStatus, 'succeeded', 'Reconciliation recovery');
          await query(
            `UPDATE payments
             SET status = 'succeeded',
                 metadata = metadata || jsonb_build_object('reconciled_at', NOW(), 'reconciled_status', 'succeeded'),
                 updated_at = NOW()
             WHERE id = $1 AND project_id = $2`,
            [paymentId, projectId]
          );
          actionTaken = 'updated_to_succeeded';
          inSync = true;
          message = `Discrepancy resolved: Local state transitioned from ${localStatus} to succeeded based on provider verification.`;
        } else {
          message = `Provider reported success, but zero-trust check failed (amount or currency mismatch).`;
        }
      } else if (providerStatus === 'failed') {
        discrepancyDetected = true;
        inSync = false;
        if (canTransition(localStatus, 'failed')) {
          await query(
            `UPDATE payments
             SET status = 'failed',
                 metadata = metadata || jsonb_build_object('reconciled_at', NOW(), 'reconciled_status', 'failed'),
                 updated_at = NOW()
             WHERE id = $1 AND project_id = $2`,
            [paymentId, projectId]
          );
          actionTaken = 'updated_to_failed';
          inSync = true;
          message = `Discrepancy resolved: Local state transitioned to failed based on provider response.`;
        }
      } else if (providerStatus === 'abandoned') {
        discrepancyDetected = true;
        inSync = false;
        if (canTransition(localStatus, 'expired')) {
          await query(
            `UPDATE payments
             SET status = 'expired',
                 metadata = metadata || jsonb_build_object('reconciled_at', NOW(), 'reconciled_status', 'expired'),
                 updated_at = NOW()
             WHERE id = $1 AND project_id = $2`,
            [paymentId, projectId]
          );
          actionTaken = 'updated_to_expired';
          inSync = true;
          message = `Discrepancy resolved: Local state transitioned to expired based on abandoned checkout.`;
        }
      } else {
        // provider is pending/ongoing
        inSync = true;
        message = 'Payment remains pending on provider.';
      }
    } else {
      // Terminal states (failed, cancelled, expired, refunded)
      inSync = true;
      message = `Payment is in terminal state '${localStatus}'.`;
    }

    return {
      paymentId,
      provider: 'Paystack',
      providerReference: reference,
      localStatus: (actionTaken === 'updated_to_succeeded'
        ? 'succeeded'
        : actionTaken === 'updated_to_failed'
        ? 'failed'
        : actionTaken === 'updated_to_expired'
        ? 'expired'
        : localStatus) as PaymentStatus,
      providerStatus,
      inSync,
      discrepancyDetected,
      actionTaken,
      message,
      updatedAt: new Date().toISOString(),
    };
  }
}
