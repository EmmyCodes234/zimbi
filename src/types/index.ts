export type EnvironmentMode = 'test' | 'production';

export interface ProjectConfig {
  project: string;
  environment: EnvironmentMode;
  name?: string;
  markets?: string[];
  providers?: Record<string, {
    connected: boolean;
    connectedAt?: string;
    environment?: EnvironmentMode;
  }>;
  webhookUrl?: string;
  updatedAt?: string;
}

export interface UserSession {
  email: string;
  userId: string;
  token: string;
  activeProject?: string;
  projects: Array<{
    id: string;
    name: string;
    createdAt: string;
  }>;
}

export interface MarketCapability {
  name: string;
  available: boolean;
}

export interface MarketInfo {
  code: string;
  name: string;
  flag: string;
  currency: string;
  status: 'active' | 'inactive';
  capabilities: string[];
  providers: string[];
  checkoutReady: boolean;
  webhooksConnected: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  status: 'connected' | 'available' | 'needs_attention';
  environment: EnvironmentMode;
  capabilities: string[];
  webhooksReceiving: boolean;
  lastSuccessfulRequest?: string;
  requiresAttentionReason?: string;
}

export interface PaymentItem {
  id: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  amount: number;
  formattedAmount: string;
  currency: string;
  market: string;
  marketCode: string;
  method: string;
  provider: string;
  providerTransactionId?: string;
  routingDecision?: string;
  checkoutUrl: string;
  createdAt: string;
  updatedAt: string;
  webhookEvents?: Array<{
    event: string;
    timestamp: string;
    status: string;
  }>;
  requestId?: string;
}

export interface DoctorCheckItem {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  fix?: string;
}

export interface DoctorReport {
  projectDetected: boolean;
  projectLinked: boolean;
  environment: EnvironmentMode;
  credentialsValid: boolean;
  marketsEnabled: string[];
  providerConnected: boolean;
  checkoutValid: boolean;
  webhooksReachable: boolean;
  signatureVerificationEnabled: boolean;
  issues: Array<{
    title: string;
    description: string;
    fixCommand?: string;
  }>;
  healthy: boolean;
}

export interface GlobalOptions {
  json?: boolean;
  verbose?: boolean;
  yes?: boolean;
  ci?: boolean;
}
