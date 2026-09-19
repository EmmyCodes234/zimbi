export interface InitializePaymentParams {
  amountMinor: number; // e.g. 2000000 for ₦20,000
  currency: string;    // 'NGN'
  email: string;
  reference: string;
  channels?: string[]; // ['card', 'bank_transfer', 'ussd']
  callbackUrl?: string;
  metadata?: Record<string, any>;
}

export interface ProviderTransactionResult {
  providerReference: string;
  authorizationUrl: string;
  accessCode?: string;
  status: 'pending';
}

export type ProviderVerificationStatus =
  | 'succeeded'
  | 'failed'
  | 'pending'
  | 'abandoned'
  | 'unknown';

export interface ProviderVerificationResult {
  status: ProviderVerificationStatus;
  reference: string;
  amountMinor: number;
  currency: string;
  gatewayResponse?: string;
  paidAt?: string;
  raw?: any;
}

export interface PaymentProvider {
  readonly id: string;
  readonly environment: 'test' | 'production';
  initializeTransaction(params: InitializePaymentParams): Promise<ProviderTransactionResult>;
  verifyTransaction(reference: string): Promise<ProviderVerificationResult>;
  verifyWebhookSignature(signature: string, rawBody: string): boolean;
  parseWebhookEvent(rawBody: string): any;
}
