-- Durable per-run retry admission. Scheduling is written before the failing holder releases.
CREATE TABLE viper_engine.run_deliveries (
  run_id viper_engine.entity_id PRIMARY KEY,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  failures bigint NOT NULL CHECK (failures >= 1),
  failed_fence bigint NOT NULL CHECK (failed_fence >= 1),
  available_at timestamptz NOT NULL,
  failure_code text NOT NULL CHECK (failure_code IN
    ('authentication_required', 'connection_unavailable', 'invalid_configuration', 'execution_failure')),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES viper_engine.runs(id, actor_id, app_id, tenant_key)
);
CREATE TRIGGER run_deliveries_owner_immutable BEFORE UPDATE ON viper_engine.run_deliveries
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_owner_change();
