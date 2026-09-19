-- Accounts (Developer / Merchant Identity)
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default legacy account if not exists
INSERT INTO accounts (id, email, name, created_at, updated_at)
VALUES ('acc_default', 'default@zimbi.dev', 'Default Account', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Account Sessions (With Server-Side Revocation)
CREATE TABLE IF NOT EXISTS account_sessions (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_account_sessions_hash ON account_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_account_sessions_account ON account_sessions(account_id);

-- Device Authorization Codes (Vercel-Style RFC 8628)
CREATE TABLE IF NOT EXISTS device_codes (
  id VARCHAR(64) PRIMARY KEY,
  device_code VARCHAR(128) UNIQUE NOT NULL,
  user_code VARCHAR(32) UNIQUE NOT NULL,
  account_id VARCHAR(64) REFERENCES accounts(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, approved, consumed, expired, denied
  attempt_count INT NOT NULL DEFAULT 0,
  client_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_codes_device ON device_codes(device_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_user ON device_codes(user_code);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  environment VARCHAR(32) NOT NULL DEFAULT 'test',
  account_id VARCHAR(64) REFERENCES accounts(id) ON DELETE CASCADE,
  slug VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS account_id VARCHAR(64) REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug VARCHAR(255);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active';
UPDATE projects SET account_id = 'acc_default' WHERE account_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_account ON projects(account_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- API Keys (Hashed)
CREATE TABLE IF NOT EXISTS api_keys (
  key_id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(128) NOT NULL,
  environment VARCHAR(32) NOT NULL DEFAULT 'test',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);

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

-- Provider Connections (Merchant-Owned Accounts)
CREATE TABLE IF NOT EXISTS provider_connections (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  environment VARCHAR(32) NOT NULL DEFAULT 'test',
  display_name VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'connected',
  credential_ciphertext TEXT NOT NULL,
  credential_iv VARCHAR(64) NOT NULL,
  credential_auth_tag VARCHAR(64) NOT NULL,
  credential_key_version INT NOT NULL DEFAULT 1,
  external_account_id VARCHAR(128),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_validated_at TIMESTAMPTZ,
  last_request_at TIMESTAMPTZ,
  last_error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT uq_project_provider_env UNIQUE (project_id, provider, environment)
);
CREATE INDEX IF NOT EXISTS idx_provider_connections_project ON provider_connections(project_id, provider, environment);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  market_code VARCHAR(8) NOT NULL,
  amount_minor BIGINT NOT NULL, -- in minor currency units (e.g. kobo)
  currency VARCHAR(8) NOT NULL,
  payment_method VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, processing, succeeded, failed
  provider_id VARCHAR(64) NOT NULL,
  provider_connection_id VARCHAR(64) REFERENCES provider_connections(id),
  provider_reference VARCHAR(128),
  authorization_url TEXT,
  request_id VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_connection_id VARCHAR(64) REFERENCES provider_connections(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_provider_ref ON payments(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_provider_conn ON payments(provider_connection_id);
CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id);
CREATE INDEX IF NOT EXISTS idx_payments_project_id_id ON payments(project_id, id);
CREATE INDEX IF NOT EXISTS idx_payments_project_created ON payments(project_id, created_at DESC);

-- Trigger for Immutable Provider Reference
CREATE OR REPLACE FUNCTION prevent_provider_ref_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
    RAISE EXCEPTION 'payments.provider_reference is immutable once set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_immutable_provider_ref ON payments;
CREATE TRIGGER trg_payments_immutable_provider_ref
BEFORE UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION prevent_provider_ref_mutation();

-- Webhook Events (Durable & Idempotent)
CREATE TABLE IF NOT EXISTS webhook_events (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
  provider_connection_id VARCHAR(64) REFERENCES provider_connections(id) ON DELETE SET NULL,
  payment_id VARCHAR(64) REFERENCES payments(id) ON DELETE SET NULL,
  provider VARCHAR(64) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  provider_event_id VARCHAR(128),
  provider_transaction_id VARCHAR(128),
  payload_hash VARCHAR(128) NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'received', -- received, processed, ignored, failed, rejected
  error_message TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_provider_event UNIQUE (provider, provider_transaction_id, event_type)
);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS provider_connection_id VARCHAR(64) REFERENCES provider_connections(id) ON DELETE SET NULL;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS payment_id VARCHAR(64) REFERENCES payments(id) ON DELETE SET NULL;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS provider_event_id VARCHAR(128);
CREATE INDEX IF NOT EXISTS idx_webhook_events_project ON webhook_events(project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_trx ON webhook_events(provider, provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_evt ON webhook_events(provider, provider_event_id);
