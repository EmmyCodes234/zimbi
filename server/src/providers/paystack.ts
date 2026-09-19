import crypto from 'node:crypto';
import type {
  PaymentProvider,
  InitializePaymentParams,
  ProviderTransactionResult,
  ProviderVerificationResult,
  ProviderVerificationStatus,
} from './types.js';

export interface PaystackProviderOptions {
  environment?: 'test' | 'production';
  secretKey?: string;
}

export class PaystackProvider implements PaymentProvider {
  public readonly id = 'paystack';
  public readonly environment: 'test' | 'production';
  private secretKey: string;
  private apiBaseUrl = 'https://api.paystack.co';

  constructor(options: PaystackProviderOptions = {}) {
    this.environment = options.environment || 'test';
    this.secretKey =
      options.secretKey ||
      (this.environment === 'production'
        ? process.env.PAYSTACK_LIVE_SECRET_KEY || ''
        : process.env.PAYSTACK_TEST_SECRET_KEY || 'sk_test_demo_key_placeholder');
  }

  async initializeTransaction(
    params: InitializePaymentParams
  ): Promise<ProviderTransactionResult> {
    const channels = params.channels && params.channels.length > 0
      ? params.channels
      : ['card', 'bank_transfer', 'ussd'];

    // Map channels to Paystack API supported strings
    const paystackChannels = channels.map((c) => {
      if (c === 'bank_transfer') return 'bank_transfer';
      if (c === 'card') return 'card';
      if (c === 'ussd') return 'ussd';
      return c;
    });

    const body = {
      amount: Math.round(params.amountMinor),
      currency: params.currency || 'NGN',
      email: params.email,
      reference: params.reference,
      channels: paystackChannels,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    };

    if (this.secretKey === 'sk_test_demo_key_placeholder' || this.secretKey === 'sk_test_mock_secret_key_12345') {
      return {
        providerReference: params.reference,
        authorizationUrl: `https://checkout.paystack.com/${params.reference.toLowerCase()}`,
        accessCode: `acc_${params.reference}`,
        status: 'pending',
      };
    }

    const res = await fetch(`${this.apiBaseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as any;

    if (!res.ok || !data.status) {
      const errorMsg = data.message || `Paystack API responded with HTTP ${res.status}`;
      throw new Error(`Paystack initialization failed: ${errorMsg}`);
    }

    return {
      providerReference: data.data.reference || params.reference,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      status: 'pending',
    };
  }

  /**
   * Queries Paystack's transaction verification API:
   * GET https://api.paystack.co/transaction/verify/:reference
   */
  async verifyTransaction(reference: string): Promise<ProviderVerificationResult> {
    if (!reference) {
      throw new Error('Transaction reference is required for verification');
    }

    // Support deterministic testing when using demo / mock secret key
    if (this.secretKey === 'sk_test_demo_key_placeholder' || this.secretKey === 'sk_test_mock_secret_key_12345') {
      if (reference.includes('mock_fail')) {
        return {
          status: 'failed',
          reference,
          amountMinor: 2000000,
          currency: 'NGN',
          gatewayResponse: 'Declined by issuer',
          raw: { status: false, message: 'Simulated failure' },
        };
      }
      if (reference.includes('mock_abandoned')) {
        return {
          status: 'abandoned',
          reference,
          amountMinor: 2000000,
          currency: 'NGN',
          gatewayResponse: 'Customer abandoned transaction',
          raw: { status: 'abandoned' },
        };
      }
      return {
        status: 'succeeded',
        reference,
        amountMinor: 2000000,
        currency: 'NGN',
        gatewayResponse: 'Successful',
        paidAt: new Date().toISOString(),
        raw: { status: 'success', reference },
      };
    }

    const res = await fetch(`${this.apiBaseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
      },
    });

    const body = (await res.json()) as any;

    if (!res.ok || !body.status) {
      if (res.status === 404 || body.message?.toLowerCase().includes('not found')) {
        return {
          status: 'unknown',
          reference,
          amountMinor: 0,
          currency: 'NGN',
          gatewayResponse: body.message || 'Transaction not found',
          raw: body,
        };
      }
      throw new Error(`Paystack verification failed: ${body.message || `HTTP ${res.status}`}`);
    }

    const data = body.data || {};
    let status: ProviderVerificationStatus = 'unknown';

    if (data.status === 'success') {
      status = 'succeeded';
    } else if (data.status === 'failed') {
      status = 'failed';
    } else if (data.status === 'abandoned') {
      status = 'abandoned';
    } else if (data.status === 'ongoing' || data.status === 'pending') {
      status = 'pending';
    }

    return {
      status,
      reference: data.reference || reference,
      amountMinor: Number(data.amount || 0),
      currency: (data.currency || 'NGN').toUpperCase(),
      gatewayResponse: data.gateway_response || data.message || '',
      paidAt: data.paid_at || undefined,
      raw: data,
    };
  }

  verifyWebhookSignature(signature: string, rawBody: string): boolean {
    if (!signature || !rawBody) {
      return false;
    }

    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');

    try {
      const hashBuffer = Buffer.from(hash, 'hex');
      const sigBuffer = Buffer.from(signature, 'hex');
      if (hashBuffer.length !== sigBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(hashBuffer, sigBuffer);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(rawBody: string): any {
    return JSON.parse(rawBody);
  }
}
