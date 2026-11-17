-- HTTP command metadata; atomic with existing run/message/idempotency stores.
CREATE TABLE viper_engine.run_instructions (
  run_id viper_engine.entity_id PRIMARY KEY REFERENCES viper_engine.runs(id),
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array' AND pg_column_size(messages) <= 262144),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES viper_engine.runs(id, actor_id, app_id, tenant_key)
);
CREATE TABLE viper_engine.input_receipts (
  run_id viper_engine.entity_id NOT NULL,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  input_id viper_engine.entity_id NOT NULL,
  fingerprint viper_engine.sha256_hex NOT NULL,
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object' AND pg_column_size(response) <= 8192),
  PRIMARY KEY (run_id, input_id),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES viper_engine.runs(id, actor_id, app_id, tenant_key)
);
CREATE TRIGGER run_instructions_immutable BEFORE UPDATE ON viper_engine.run_instructions
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();
CREATE TRIGGER input_receipts_immutable BEFORE UPDATE ON viper_engine.input_receipts
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();
