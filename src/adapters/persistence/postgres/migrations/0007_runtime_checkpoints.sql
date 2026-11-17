CREATE TABLE viper_engine.runtime_checkpoints (
  run_id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  revision viper_engine.revision,
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object' AND pg_column_size(state) <= 2097152),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES viper_engine.runs (id, actor_id, app_id, tenant_key)
);
CREATE TRIGGER revision_step BEFORE UPDATE OF revision ON viper_engine.runtime_checkpoints
  FOR EACH ROW EXECUTE FUNCTION viper_engine.enforce_revision_step();
CREATE TRIGGER owner_fixed BEFORE UPDATE ON viper_engine.runtime_checkpoints
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_owner_change();
