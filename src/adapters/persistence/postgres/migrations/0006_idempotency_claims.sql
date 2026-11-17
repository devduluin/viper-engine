-- Every reservation generation has a distinct identity. Old requests cannot complete/delete
-- a replacement reservation, including when both requests have the same payload fingerprint.
ALTER TABLE viper_engine.request_idempotency
  ADD COLUMN claim_id uuid NOT NULL DEFAULT gen_random_uuid();
