export const IDEMPOTENCY_SPIKE_SCHEMA = `
CREATE TABLE viper_engine.request_idempotency (
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (length(operation) BETWEEN 1 AND 64 AND substr(operation, 1, 1) GLOB '[a-z]'
    AND operation NOT GLOB '*[^a-z0-9_.]*'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64 AND payload_fingerprint NOT GLOB '*[^0-9a-f]*'),
  resource_ref TEXT CHECK (length(resource_ref) BETWEEN 1 AND 512),
  claim_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
  PRIMARY KEY (actor_id, app_id, tenant_key, operation, idempotency_key)
) STRICT;
CREATE INDEX viper_engine.request_idempotency_expiry ON request_idempotency (expires_at_ms);
`;
