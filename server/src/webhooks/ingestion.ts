import crypto from 'node:crypto';
import { query } from '../db/connection.js';
import { PaystackProvider } from '../providers/paystack.js';
import { decryptSecret } from '../auth/encryption.js';
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
  async processPaystackWebhook(
    signature: string | undefined,
    rawBody: string | undefined
  ): Promise<WebhookIngestionResult> {
    if (!rawBody || !signature) {
      return {
        accepted: false,
        duplicate: false,
        signatureVerified: false,
        paymentUpdated: false,
        error: 'Missing raw webhook body or x-paystack-signature header',
      };
    }

    // Step 1: Parse JSON safely to extract candidate reference/id
    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(rawBody);
    } catch {
      return {
        accepted: false,
        duplicate: false,
        signatureVerified: false,
        paymentUpdated: false,
        error: 'Invalid JSON payload',
      };
    }

    const data = parsedPayload.data || {};
    const reference = String(data.reference || data.id || '');
    const eventType = String(parsedPayload.event || 'unknown');
    const providerTransactionId = reference || crypto.randomUUID();
    const providerEventId = String(
      parsedPayload.id || parsedPayload.event_id || data.id || ''
    ) || null;
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const eventId = `wh_evt_${crypto.randomBytes(8).toString('hex')}`;

    if (!reference) {
      return {
        accepted: false,
        duplicate: false,
        signatureVerified: false,
        paymentUpdated: false,
        error: 'Missing payment reference in webhook payload',
      };
    }

    // Step 2: Query candidate payment and owning connection strictly by immutable provider_reference
    // ZERO-FALLBACK RULE: No global provider connection fallbacks permitted!
    const payRes = await query(
      `SELECT p.id, p.status, p.amount_minor, p.currency, p.project_id, p.provider_connection_id,
              pc.credential_ciphertext, pc.credential_iv, pc.credential_auth_tag, pc.credential_key_version, pc.status as connection_status
       FROM payments p
       JOIN provider_connections pc ON p.provider_connection_id = pc.id
       WHERE p.provider_reference = $1`,
      [reference]
    );

    if (payRes.rows.length === 0) {
      // Record rejected audit event without decrypting any keys
      try {
        await query(
          `INSERT INTO webhook_events (
            id, provider, event_type, provider_event_id, provider_transaction_id,
            payload_hash, signature_verified, processing_status, error_message, payload, received_at
          ) VALUES ($1, 'paystack', $2, $3, $4, $5, false, 'rejected', 'No matching candidate payment or connected provider connection found for reference', $6, NOW())`,
          [eventId, eventType, providerEventId, providerTransactionId, payloadHash, parsedPayload]
        );
      } catch (err: any) {
        console.warn('Failed to log rejected webhook event:', err.message);
      }

      return {
        accepted: false,
        duplicate: false,
        signatureVerified: false,
        paymentUpdated: false,
        error: 'No matching payment and connection found for reference',
      };
    }

    const candidatePayment = payRes.rows[0];

    // Step 3: Decrypt connection secret in memory ONLY after candidate payment is located
    let secretKey = '';
    try {
      secretKey = decryptSecret({
        ciphertext: candidatePayment.credential_ciphertext,
        iv: candidatePayment.credential_iv,
        authTag: candidatePayment.credential_auth_tag,
        keyVersion: candidatePayment.credential_key_version,
      });
    } catch (decErr: any) {
      console.warn('Failed to decrypt connection secret for webhook:', decErr.message);
      return {
        accepted: false,
        duplicate: false,
        signatureVerified: false,
        paymentUpdated: false,
        error: 'Failed to decrypt provider credentials for webhook verification',
      };
    }

    // Step 4: STRICT SIGNATURE-FIRST VERIFICATION
    // Verify HMAC-SHA512 BEFORE trusting payload, modifying database state, or processing payment.
    const paystackProvider = new PaystackProvider({ secretKey });
    const signatureVerified = paystackProvider.verifyWebhookSignature(signature, rawBody);

    if (!signatureVerified) {
      // Store unverified audit event with rejected status and tenant context
      try {
        await query(
          `INSERT INTO webhook_events (
            id, project_id, provider_connection_id, payment_id, provider, event_type, provider_event_id, provider_transaction_id,
            payload_hash, signature_verified, processing_status, error_message, payload, received_at
          ) VALUES ($1, $2, $3, $4, 'paystack', $5, $6, $7, $8, false, 'rejected', 'Invalid HMAC-SHA512 signature', $9, NOW())`,
          [
            eventId,
            candidatePayment.project_id,
            candidatePayment.provider_connection_id,
            candidatePayment.id,
            eventType,
            providerEventId,
            providerTransactionId,
            payloadHash,
            parsedPayload,
          ]
        );
      } catch (err: any) {
        console.warn('Failed to log rejected webhook event:', err.message);
      }

      return {
        accepted: false,
        duplicate: false,
        signatureVerified: false,
        paymentUpdated: false,
        error: 'Invalid webhook signature - rejected prior to state change',
      };
    }

    // Step 5: Idempotency Check & Ingestion for authenticated webhook
    try {
      await query(
        `INSERT INTO webhook_events (
          id, project_id, provider_connection_id, payment_id, provider, event_type, provider_event_id, provider_transaction_id,
          payload_hash, signature_verified, processing_status, payload, received_at
        ) VALUES ($1, $2, $3, $4, 'paystack', $5, $6, $7, $8, true, 'received', $9, NOW())
        ON CONFLICT (provider, provider_transaction_id, event_type) DO NOTHING`,
        [
          eventId,
          candidatePayment.project_id,
          candidatePayment.provider_connection_id,
          candidatePayment.id,
          eventType,
          providerEventId,
          providerTransactionId,
          payloadHash,
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
        signatureVerified: true,
        paymentUpdated: false,
      };
    }

    // Step 6: Process Domain Events according to State Machine
    let paymentUpdated = false;
    let processingStatus: 'processed' | 'ignored' | 'failed' = 'ignored';
    let errorMessage: string | null = null;

    try {
      if (eventType === 'charge.success') {
        const amountMinor = Number(data.amount);
        const currency = String(data.currency || 'NGN').toUpperCase();
        const currentStatus = candidatePayment.status as PaymentStatus;

        // Zero-Trust verification: amount, currency, and valid state transition
        const amountMatches = Number(candidatePayment.amount_minor) === amountMinor;
        const currencyMatches = candidatePayment.currency.toUpperCase() === currency;

        if (!amountMatches) {
          throw new Error(
            `Amount mismatch: expected ${candidatePayment.amount_minor} minor units, received ${amountMinor}`
          );
        }
        if (!currencyMatches) {
          throw new Error(
            `Currency mismatch: expected ${candidatePayment.currency}, received ${currency}`
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
            `Webhook charge.success for payment ${candidatePayment.id}`
          );

          await query(
            `UPDATE payments
             SET status = 'succeeded', updated_at = NOW()
             WHERE id = $1 AND project_id = $2`,
            [candidatePayment.id, candidatePayment.project_id]
          );
          paymentUpdated = true;
          processingStatus = 'processed';
        }
      } else if (eventType === 'charge.failed') {
        const currentStatus = candidatePayment.status as PaymentStatus;

        if (canTransition(currentStatus, 'failed')) {
          await query(
            `UPDATE payments
             SET status = 'failed', updated_at = NOW()
             WHERE id = $1 AND project_id = $2`,
            [candidatePayment.id, candidatePayment.project_id]
          );
          paymentUpdated = true;
          processingStatus = 'processed';
        } else {
          processingStatus = 'ignored';
          errorMessage = `Payment in state '${currentStatus}' cannot transition to 'failed'`;
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

    // Step 7: Update webhook event status for durable reprocessing & auditability
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
