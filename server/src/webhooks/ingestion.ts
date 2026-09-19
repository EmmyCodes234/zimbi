import crypto from 'node:crypto';
import { query } from '../db/connection.js';
import { PaystackProvider } from '../providers/paystack.js';
import {
  canTransition,
  assertValidTransition,
  PaymentStatus,
} from '../payments/stateMachine.js';

export interface WebhookIngestionResult {
  accepted: boolean;
  duplicate: boolean;
  signatureVerified: boolean;
  paymentUpdated: boolean;
  error?: string;
}

export class WebhookIngestionService {
  private paystackProvider: PaystackProvider;

  constructor() {
    this.paystackProvider = new PaystackProvider({ environment: 'test' });
  }

  async processPaystackWebhook(
    signature: string | undefined,
    rawBody: string | undefined
  ): Promise<WebhookIngestionResult> {
    if (!rawBody) {
      return {
        accepted: false,
        duplicate: false,
        signatureVerified: false,
        paymentUpdated: false,
        error: 'Missing raw webhook body',
      };
    }

    // 1. Signature Verification
    const signatureVerified = this.paystackProvider.verifyWebhookSignature(
      signature || '',
      rawBody
    );

    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(rawBody);
    } catch {
      return {
        accepted: false,
        duplicate: false,
        signatureVerified,
        paymentUpdated: false,
        error: 'Invalid JSON payload',
      };
    }

    const eventType = String(parsedPayload.event || 'unknown');
    const data = parsedPayload.data || {};
    const providerTransactionId = String(data.reference || data.id || crypto.randomUUID());
    const providerEventId = String(
      parsedPayload.id || parsedPayload.event_id || data.id || ''
    ) || null;
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const eventId = `wh_evt_${crypto.randomBytes(8).toString('hex')}`;

    // 2. Idempotency Check & Ingestion
    try {
      await query(
        `INSERT INTO webhook_events (
          id, provider, event_type, provider_event_id, provider_transaction_id,
          payload_hash, signature_verified, processing_status, payload, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'received', $8, NOW())
        ON CONFLICT (provider, provider_transaction_id, event_type) DO NOTHING`,
        [
          eventId,
          'paystack',
          eventType,
          providerEventId,
          providerTransactionId,
          payloadHash,
          signatureVerified,
          parsedPayload,
        ]
      );
    } catch (dbErr: any) {
      console.warn('Webhook idempotency insert warning:', dbErr.message);
    }

    // Check if this event was already processed
    const existing = await query(
      `SELECT id, processing_status FROM webhook_events
       WHERE provider = 'paystack' AND provider_transaction_id = $1 AND event_type = $2`,
      [providerTransactionId, eventType]
    );

    if (existing.rows.length > 0 && existing.rows[0].processing_status === 'processed') {
      return {
        accepted: true,
        duplicate: true,
        signatureVerified,
        paymentUpdated: false,
      };
    }

    // 3. Process Domain Events according to State Machine
    let paymentUpdated = false;
    let processingStatus: 'processed' | 'ignored' | 'failed' = 'ignored';
    let errorMessage: string | null = null;

    try {
      if (eventType === 'charge.success' && data.reference) {
        const reference = data.reference;
        const amountMinor = Number(data.amount);
        const currency = String(data.currency || 'NGN').toUpperCase();

        const payRes = await query(
          `SELECT * FROM payments WHERE provider_reference = $1`,
          [reference]
        );

        if (payRes.rows.length > 0) {
          const payment = payRes.rows[0];
          const currentStatus = payment.status as PaymentStatus;

          // Zero-Trust verification: amount, currency, and valid state transition
          const amountMatches = Number(payment.amount_minor) === amountMinor;
          const currencyMatches = payment.currency.toUpperCase() === currency;

          if (!amountMatches) {
            throw new Error(
              `Amount mismatch: expected ${payment.amount_minor} minor units, received ${amountMinor}`
            );
          }
          if (!currencyMatches) {
            throw new Error(
              `Currency mismatch: expected ${payment.currency}, received ${currency}`
            );
          }

          if (currentStatus === 'succeeded') {
            // Already succeeded: idempotent no-op
            processingStatus = 'processed';
          } else {
            // Check state machine
            assertValidTransition(
              currentStatus,
              'succeeded',
              `Webhook charge.success for payment ${payment.id}`
            );

            await query(
              `UPDATE payments
               SET status = 'succeeded', updated_at = NOW()
               WHERE id = $1`,
              [payment.id]
            );
            paymentUpdated = true;
            processingStatus = 'processed';
          }
        } else {
          // No matching payment record found
          processingStatus = 'ignored';
          errorMessage = `No matching payment record found for reference ${reference}`;
        }
      } else if (eventType === 'charge.failed' && data.reference) {
        const reference = data.reference;
        const payRes = await query(
          `SELECT * FROM payments WHERE provider_reference = $1`,
          [reference]
        );

        if (payRes.rows.length > 0) {
          const payment = payRes.rows[0];
          const currentStatus = payment.status as PaymentStatus;

          if (canTransition(currentStatus, 'failed')) {
            await query(
              `UPDATE payments
               SET status = 'failed', updated_at = NOW()
               WHERE id = $1`,
              [payment.id]
            );
            paymentUpdated = true;
            processingStatus = 'processed';
          } else {
            processingStatus = 'ignored';
            errorMessage = `Payment in state '${currentStatus}' cannot transition to 'failed'`;
          }
        }
      } else {
        // Event received and stored, but no state change required
        processingStatus = 'processed';
      }
    } catch (err: any) {
      processingStatus = 'failed';
      errorMessage = err.message || 'Unknown processing error';
      console.error('Error processing webhook event:', err);
    }

    // 4. Update webhook event status for durable reprocessing & auditability
    await query(
      `UPDATE webhook_events
       SET processing_status = $1, processed_at = NOW(), error_message = $2
       WHERE provider = 'paystack' AND provider_transaction_id = $3 AND event_type = $4`,
      [processingStatus, errorMessage, providerTransactionId, eventType]
    );

    return {
      accepted: true,
      duplicate: false,
      signatureVerified,
      paymentUpdated,
      error: errorMessage || undefined,
    };
  }
}
