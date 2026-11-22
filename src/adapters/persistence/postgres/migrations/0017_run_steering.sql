-- Mid-run steering: user messages accepted while a run works. The API only queues them under the run lock;
-- the run's lease holder appends them to the conversation at a step boundary and settles them in the same
-- journal commit. A settled row is immutable: consumed (in the conversation) or discarded (run ended first).
CREATE TABLE viper_engine.run_steering_inputs (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  message_id viper_engine.entity_id PRIMARY KEY,
  run_id viper_engine.entity_id NOT NULL,
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  input_id viper_engine.entity_id NOT NULL,
  message jsonb NOT NULL CHECK (jsonb_typeof(message) = 'object' AND message->>'role' = 'user'
    AND message->>'id' = message_id AND pg_column_size(message) <= 262144),
  created_at timestamptz NOT NULL,
  settled_at timestamptz NULL,
  outcome text NULL CONSTRAINT run_steering_outcome CHECK (outcome IN ('consumed', 'discarded')),
  CONSTRAINT run_steering_settled_pair CHECK ((settled_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT run_steering_input_unique UNIQUE (run_id, input_id),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES viper_engine.runs(id, actor_id, app_id, tenant_key)
);
CREATE INDEX run_steering_pending ON viper_engine.run_steering_inputs (run_id, seq) WHERE settled_at IS NULL;

CREATE FUNCTION viper_engine.settle_steering_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.settled_at IS NOT NULL OR NEW.settled_at IS NULL
    OR (NEW.seq, NEW.message_id, NEW.run_id, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.input_id, NEW.created_at)
      IS DISTINCT FROM (OLD.seq, OLD.message_id, OLD.run_id, OLD.actor_id, OLD.app_id, OLD.tenant_key, OLD.input_id, OLD.created_at)
    OR NEW.message IS DISTINCT FROM OLD.message THEN
    RAISE EXCEPTION 'Steering input is settled exactly once and is otherwise immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_steering_settle_once BEFORE UPDATE ON viper_engine.run_steering_inputs
  FOR EACH ROW EXECUTE FUNCTION viper_engine.settle_steering_once();
CREATE TRIGGER run_steering_no_delete BEFORE DELETE ON viper_engine.run_steering_inputs
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();
