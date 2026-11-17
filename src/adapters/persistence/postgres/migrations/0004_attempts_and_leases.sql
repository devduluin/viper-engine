-- P04-02: tool-call attempt ledger and lease support. Leases use the reserved runs columns
-- (lease_owner, lease_expires_at, lease_fence) from 0001.

CREATE TABLE viper_engine.tool_call_attempts (
  run_id viper_engine.entity_id NOT NULL,
  tool_call_id viper_engine.entity_id NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  actor_id viper_engine.entity_id NOT NULL,
  app_id viper_engine.entity_id NOT NULL,
  tenant_key viper_engine.tenant_key,
  worker_id text NULL CHECK (length(worker_id) BETWEEN 1 AND 128),
  lease_fence bigint NULL CHECK (lease_fence >= 1),
  dispatched_at timestamptz NOT NULL,
  settled_at timestamptz NULL CHECK (settled_at >= dispatched_at),
  result_kind text NULL CHECK (result_kind IN ('succeeded', 'failed', 'unknown', 'retry_wait')),
  evidence jsonb NULL CHECK (jsonb_typeof(evidence) = 'object' AND pg_column_size(evidence) <= 16384),
  CHECK ((settled_at IS NULL) = (result_kind IS NULL)),
  CHECK ((worker_id IS NULL) = (lease_fence IS NULL)),
  PRIMARY KEY (run_id, tool_call_id, attempt),
  FOREIGN KEY (run_id, tool_call_id, actor_id, app_id, tenant_key)
    REFERENCES viper_engine.tool_calls (run_id, id, actor_id, app_id, tenant_key)
);

-- An attempt is settled at most once and its identity never changes; rows are never deleted
-- by run completion (the ledger outlives the run).
CREATE FUNCTION viper_engine.guard_attempt_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'tool call attempt already settled' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.run_id, NEW.tool_call_id, NEW.attempt, NEW.actor_id, NEW.app_id, NEW.tenant_key, NEW.worker_id,
      NEW.lease_fence, NEW.dispatched_at)
     IS DISTINCT FROM (OLD.run_id, OLD.tool_call_id, OLD.attempt, OLD.actor_id, OLD.app_id, OLD.tenant_key,
      OLD.worker_id, OLD.lease_fence, OLD.dispatched_at) THEN
    RAISE EXCEPTION 'tool call attempt identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER settle_once BEFORE UPDATE ON viper_engine.tool_call_attempts
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_attempt_update();
CREATE TRIGGER no_delete BEFORE DELETE ON viper_engine.tool_call_attempts
  FOR EACH ROW EXECUTE FUNCTION viper_engine.reject_update();

-- At most one open (unsettled) attempt per tool call.
CREATE UNIQUE INDEX tool_call_attempts_one_open ON viper_engine.tool_call_attempts (run_id, tool_call_id)
  WHERE settled_at IS NULL;

-- Lease consistency: an owner always comes with an expiry (0001), and claims raise the fence.
CREATE FUNCTION viper_engine.guard_lease_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lease_fence < OLD.lease_fence THEN
    RAISE EXCEPTION 'lease fence cannot decrease' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fence_monotonic BEFORE UPDATE OF lease_fence ON viper_engine.runs
  FOR EACH ROW EXECUTE FUNCTION viper_engine.guard_lease_fence();
