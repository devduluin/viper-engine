-- A retained prefix may be pruned without resetting durable sequence allocation.
CREATE OR REPLACE FUNCTION viper_engine.guard_run_event_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous bigint; high_water bigint;
BEGIN
  SELECT last_event_sequence INTO high_water FROM viper_engine.runs WHERE id = NEW.run_id;
  SELECT max(sequence) INTO previous FROM viper_engine.run_events WHERE run_id = NEW.run_id;
  IF NEW.sequence <> greatest(coalesce(previous, 0), high_water) + 1 THEN
    RAISE EXCEPTION 'run event sequence gap' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
