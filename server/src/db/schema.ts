export const SCHEMA_DDL = `
-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  environment VARCHAR(32) NOT NULL DEFAULT 'test',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys (Hashed)
CREATE TABLE IF NOT EXISTS api_keys (
  key_id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(128) NOT NULL,
  environment VARCHAR(32) NOT NULL DEFAULT 'test',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Markets
CREATE TABLE IF NOT EXISTS markets (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code VARCHAR(8) NOT NULL,
  name VARCHAR(128) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'inactive',
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_project_market UNIQUE (project_id, code)
);

-- Providers
CREATE TABLE IF NOT EXISTS providers (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'available',
  environment VARCHAR(32) NOT NULL DEFAULT 'test',
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_request_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_project_provider UNIQUE (project_id, provider_id, environment)
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  market_code VARCHAR(8) NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency VARCHAR(8) NOT NULL,
  payment_method VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  provider_id VARCHAR(64) NOT NULL,
  provider_reference VARCHAR(128),
  authorization_url TEXT,
  request_id VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_reference);
CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id);

-- Webhook Events (Durable & Idempotent)
CREATE TABLE IF NOT EXISTS webhook_events (
  id VARCHAR(64) PRIMARY KEY,
  provider VARCHAR(64) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  provider_event_id VARCHAR(128),
  provider_transaction_id VARCHAR(128),
  payload_hash VARCHAR(128) NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'received',
  error_message TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_provider_event UNIQUE (provider, provider_transaction_id, event_type)
);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS provider_event_id VARCHAR(128);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_trx ON webhook_events(provider, provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_evt ON webhook_events(provider, provider_event_id);
`;
