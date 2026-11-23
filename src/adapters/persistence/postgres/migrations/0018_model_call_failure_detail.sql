-- Safe provider metadata for failed model calls (HTTP status, provider error type, request id) so a rejection can be
-- diagnosed afterwards. Never provider error text: it can echo prompt content.
ALTER TABLE viper_engine.model_calls ADD COLUMN failure_detail text
  CHECK (failure_detail IS NULL OR (outcome = 'failed' AND failure_detail ~ '^[A-Za-z0-9_.: -]{1,200}$'));
