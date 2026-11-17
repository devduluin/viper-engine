-- P04-01 schema constraint suite. Run against a FRESH, ISOLATED database after migrations
-- (normally applied by the runner; tests/integration/postgres/schema.test.ts does both):
--   psql -v ON_ERROR_STOP=1 -1 -c "CREATE SCHEMA viper_engine" -f 0001_initial.sql -f 0002_execution_ledger.sql
--   psql -v ON_ERROR_STOP=1 -f tests/integration/postgres/schema-constraints.sql
-- Everything runs in one transaction that is rolled back. Any failed expectation aborts.
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL search_path = viper_engine;

CREATE TEMP TABLE results (name text PRIMARY KEY);

CREATE FUNCTION pg_temp.expect_error(label text, statement text, state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN others THEN
    IF SQLSTATE <> state THEN
      RAISE EXCEPTION '% : expected SQLSTATE %, got % (%)', label, state, SQLSTATE, SQLERRM;
    END IF;
    INSERT INTO results VALUES (label);
    RETURN;
  END;
  RAISE EXCEPTION '% : statement unexpectedly succeeded', label;
END $$;

CREATE FUNCTION pg_temp.expect_ok(label text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  INSERT INTO results VALUES (label);
END $$;

-- Valid seed: one tenant-less owner u1/a1, one other actor u2 ---------------------------
INSERT INTO mcp_servers (id, app_id, tenant_key, transport, endpoint_ref) VALUES ('s1', 'a1', '', 'stdio', 'ref:s1'),
  ('s2', 'a1', '', 'stdio', 'ref:s2');
INSERT INTO mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state) VALUES
  ('c1', 'u1', 'a1', '', 's1', 'ready'), ('c2', 'u2', 'a1', '', 's1', 'ready');
INSERT INTO conversations (id, actor_id, app_id, tenant_key) VALUES ('conv1', 'u1', 'a1', '');
INSERT INTO runs (id, actor_id, app_id, tenant_key, conversation_id, status) VALUES ('r1', 'u1', 'a1', '', 'conv1', 'running');
INSERT INTO run_steps (run_id, step_index, id, actor_id, app_id, tenant_key) VALUES ('r1', 1, 'step1', 'u1', 'a1', '');
INSERT INTO tool_calls (run_id, id, actor_id, app_id, tenant_key, step_id, status, connection_id, server_id,
  tool_name, definition_version, schema_snapshot, arguments, arguments_digest, requires_approval)
VALUES ('r1', 'tc1', 'u1', 'a1', '', 'step1', 'awaiting_approval', 'c1', 's1', 'lookup', 'v1', '{}', '{"id":"a"}',
  repeat('a', 64), true);
INSERT INTO approvals (id, actor_id, app_id, tenant_key, run_id, tool_call_id, connection_id, server_id, tool_name,
  definition_version, arguments_digest, status, expires_at, arguments, tool_snapshot)
VALUES ('ap1', 'u1', 'a1', '', 'r1', 'tc1', 'c1', 's1', 'lookup', 'v1', repeat('a', 64), 'pending', now() + interval '1 hour', '{}', '{"inputSchema":{"type":"object"}}');
INSERT INTO run_events (run_id, sequence, event_id, actor_id, app_id, tenant_key, conversation_id, type, occurred_at)
VALUES ('r1', 1, 'ev1', 'u1', 'a1', '', 'conv1', 'run.started', now());
INSERT INTO messages (id, actor_id, app_id, tenant_key, conversation_id, run_id, position, role, content, tool_calls)
VALUES ('m1', 'u1', 'a1', '', 'conv1', 'r1', 1, 'assistant', '[]', '[{"id":"tc1"}]');

-- Ownership: children cannot cross owners --------------------------------------------------
SELECT pg_temp.expect_error('run under another actor''s conversation',
  $q$INSERT INTO runs (id, actor_id, app_id, tenant_key, conversation_id, status) VALUES ('r2', 'u2', 'a1', '', 'conv1', 'queued')$q$, '23503');
SELECT pg_temp.expect_error('run under another tenant key',
  $q$INSERT INTO runs (id, actor_id, app_id, tenant_key, conversation_id, status) VALUES ('r2', 'u1', 'a1', 't1', 'conv1', 'queued')$q$, '23503');
SELECT pg_temp.expect_error('tool call on another actor''s connection',
  $q$INSERT INTO tool_calls (run_id, id, actor_id, app_id, tenant_key, step_id, status, connection_id, server_id, tool_name,
     definition_version, schema_snapshot, arguments, arguments_digest, requires_approval)
     VALUES ('r1', 'tc2', 'u1', 'a1', '', 'step1', 'proposed', 'c2', 's1', 'x', 'v1', '{}', '{}', repeat('b', 64), false)$q$, '23503');
SELECT pg_temp.expect_error('tool call with a server that is not the connection''s',
  $q$INSERT INTO tool_calls (run_id, id, actor_id, app_id, tenant_key, step_id, status, connection_id, server_id, tool_name,
     definition_version, schema_snapshot, arguments, arguments_digest, requires_approval)
     VALUES ('r1', 'tc2', 'u1', 'a1', '', 'step1', 'proposed', 'c1', 's2', 'x', 'v1', '{}', '{}', repeat('b', 64), false)$q$, '23503');
SELECT pg_temp.expect_error('event under another actor',
  $q$INSERT INTO run_events (run_id, sequence, event_id, actor_id, app_id, tenant_key, conversation_id, type, occurred_at)
     VALUES ('r1', 2, 'ev2', 'u2', 'a1', '', 'conv1', 'step.started', now())$q$, '23503');
SELECT pg_temp.expect_error('owner columns are immutable',
  $q$UPDATE runs SET actor_id = 'u2' WHERE id = 'r1'$q$, '23514');

-- Revisions: compare-and-set step of exactly one ------------------------------------------
SELECT pg_temp.expect_ok('CAS update with revision + 1',
  $q$UPDATE runs SET revision = revision + 1, status = 'waiting_for_approval' WHERE id = 'r1' AND revision = 1$q$);
SELECT pg_temp.expect_error('revision jump', $q$UPDATE runs SET revision = revision + 2 WHERE id = 'r1'$q$, '23514');
SELECT pg_temp.expect_error('revision reuse', $q$UPDATE conversations SET revision = 1, title = 'x' WHERE id = 'conv1'$q$, '23514');
SELECT pg_temp.expect_error('revision below one', $q$UPDATE conversations SET revision = 0 WHERE id = 'conv1'$q$, '23514');

-- Tool-call ledger ------------------------------------------------------------------------
SELECT pg_temp.expect_error('dispatched states need an attempt',
  $q$UPDATE tool_calls SET status = 'dispatching', revision = revision + 1 WHERE id = 'tc1'$q$, '23514');
SELECT pg_temp.expect_ok('dispatch increments attempts',
  $q$UPDATE tool_calls SET status = 'dispatching', attempts = 1, revision = revision + 1 WHERE id = 'tc1'$q$);
SELECT pg_temp.expect_error('attempts cannot decrease',
  $q$UPDATE tool_calls SET attempts = 0, status = 'ready', revision = revision + 1 WHERE id = 'tc1'$q$, '23514');
SELECT pg_temp.expect_error('arguments are immutable',
  $q$UPDATE tool_calls SET arguments = '{"id":"b"}', revision = revision + 1 WHERE id = 'tc1'$q$, '23514');
SELECT pg_temp.expect_error('approval requirement is immutable',
  $q$UPDATE tool_calls SET requires_approval = false, revision = revision + 1 WHERE id = 'tc1'$q$, '23514');
SELECT pg_temp.expect_error('unknown tool status', $q$UPDATE tool_calls SET status = 'done', revision = revision + 1 WHERE id = 'tc1'$q$, '23514');
SELECT pg_temp.expect_error('digest must be lowercase sha-256 hex',
  $q$INSERT INTO tool_calls (run_id, id, actor_id, app_id, tenant_key, step_id, status, connection_id, server_id, tool_name,
     definition_version, schema_snapshot, arguments, arguments_digest, requires_approval)
     VALUES ('r1', 'tc3', 'u1', 'a1', '', 'step1', 'proposed', 'c1', 's1', 'x', 'v1', '{}', '{}', repeat('A', 64), false)$q$, '23514');

-- Approvals -------------------------------------------------------------------------------
SELECT pg_temp.expect_error('approval binding must equal the tool call',
  $q$INSERT INTO approvals (id, actor_id, app_id, tenant_key, run_id, tool_call_id, connection_id, server_id, tool_name,
     definition_version, arguments_digest, status, expires_at, arguments, tool_snapshot)
     VALUES ('ap2', 'u1', 'a1', '', 'r1', 'tc1', 'c1', 's1', 'lookup', 'v2', repeat('a', 64), 'superseded', now() + interval '1 hour', '{}', '{"inputSchema":{"type":"object"}}')$q$, '23503');
SELECT pg_temp.expect_error('only one live approval per call',
  $q$INSERT INTO approvals (id, actor_id, app_id, tenant_key, run_id, tool_call_id, connection_id, server_id, tool_name,
     definition_version, arguments_digest, status, expires_at, arguments, tool_snapshot)
     VALUES ('ap2', 'u1', 'a1', '', 'r1', 'tc1', 'c1', 's1', 'lookup', 'v1', repeat('a', 64), 'pending', now() + interval '1 hour', '{}', '{"inputSchema":{"type":"object"}}')$q$, '23505');
SELECT pg_temp.expect_error('approval binding is immutable',
  $q$UPDATE approvals SET expires_at = expires_at + interval '1 day', revision = revision + 1 WHERE id = 'ap1'$q$, '23514');
SELECT pg_temp.expect_error('consumed needs consumed_at',
  $q$UPDATE approvals SET status = 'consumed', decided_at = now(), revision = revision + 1 WHERE id = 'ap1'$q$, '23514');

-- Events: gap-free, append-only -----------------------------------------------------------
SELECT pg_temp.expect_error('event sequence gap',
  $q$INSERT INTO run_events (run_id, sequence, event_id, actor_id, app_id, tenant_key, conversation_id, type, occurred_at)
     VALUES ('r1', 3, 'ev3', 'u1', 'a1', '', 'conv1', 'step.started', now())$q$, '23514');
SELECT pg_temp.expect_error('event sequence reuse',
  $q$INSERT INTO run_events (run_id, sequence, event_id, actor_id, app_id, tenant_key, conversation_id, type, occurred_at)
     VALUES ('r1', 1, 'ev3', 'u1', 'a1', '', 'conv1', 'step.started', now())$q$, '23514');
SELECT pg_temp.expect_ok('next event appends',
  $q$INSERT INTO run_events (run_id, sequence, event_id, actor_id, app_id, tenant_key, conversation_id, type, occurred_at)
     VALUES ('r1', 2, 'ev2', 'u1', 'a1', '', 'conv1', 'step.started', now())$q$);
SELECT pg_temp.expect_error('events are append-only', $q$UPDATE run_events SET payload = '{"x":1}' WHERE event_id = 'ev1'$q$, '23514');
SELECT pg_temp.expect_error('unknown event type',
  $q$INSERT INTO run_events (run_id, sequence, event_id, actor_id, app_id, tenant_key, conversation_id, type, occurred_at)
     VALUES ('r1', 3, 'ev3', 'u1', 'a1', '', 'conv1', 'tool.delta', now())$q$, '23514');

-- Messages --------------------------------------------------------------------------------
SELECT pg_temp.expect_ok('tool result message',
  $q$INSERT INTO messages (id, actor_id, app_id, tenant_key, conversation_id, run_id, position, role, content, tool_call_id, outcome)
     VALUES ('m2', 'u1', 'a1', '', 'conv1', 'r1', 2, 'tool', '[]', 'tc1', 'unknown')$q$);
SELECT pg_temp.expect_error('one result per tool call',
  $q$INSERT INTO messages (id, actor_id, app_id, tenant_key, conversation_id, run_id, position, role, content, tool_call_id, outcome)
     VALUES ('m3', 'u1', 'a1', '', 'conv1', 'r1', 3, 'tool', '[]', 'tc1', 'success')$q$, '23505');
SELECT pg_temp.expect_error('tool result needs an outcome',
  $q$INSERT INTO messages (id, actor_id, app_id, tenant_key, conversation_id, position, role, content, tool_call_id)
     VALUES ('m3', 'u1', 'a1', '', 'conv1', 3, 'tool', '[]', 'tc9')$q$, '23514');
SELECT pg_temp.expect_error('stable unique position',
  $q$INSERT INTO messages (id, actor_id, app_id, tenant_key, conversation_id, position, role, content)
     VALUES ('m3', 'u1', 'a1', '', 'conv1', 2, 'user', '[]')$q$, '23505');
SELECT pg_temp.expect_error('only assistants carry tool calls',
  $q$INSERT INTO messages (id, actor_id, app_id, tenant_key, conversation_id, position, role, content, tool_calls)
     VALUES ('m3', 'u1', 'a1', '', 'conv1', 3, 'user', '[]', '[]')$q$, '23514');
SELECT pg_temp.expect_error('messages are append-only', $q$UPDATE messages SET content = '[1]' WHERE id = 'm1'$q$, '23514');

-- Identity, tenancy, usage, idempotency, connections --------------------------------------
SELECT pg_temp.expect_error('ids reject whitespace',
  $q$INSERT INTO conversations (id, actor_id, app_id, tenant_key) VALUES ('conv 2', 'u1', 'a1', '')$q$, '23514');
SELECT pg_temp.expect_error('ids reject empty strings',
  $q$INSERT INTO conversations (id, actor_id, app_id, tenant_key) VALUES ('', 'u1', 'a1', '')$q$, '23514');
SELECT pg_temp.expect_error('tenant key is never NULL',
  $q$INSERT INTO conversations (id, actor_id, app_id, tenant_key) VALUES ('conv2', 'u1', 'a1', NULL)$q$, '23502');
SELECT pg_temp.expect_error('one live connection per owner and server',
  $q$INSERT INTO mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state) VALUES ('c3', 'u1', 'a1', '', 's1', 'ready')$q$, '23505');
SELECT pg_temp.expect_error('connection tenant must match its server',
  $q$INSERT INTO mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state) VALUES ('c3', 'u1', 'a1', 't1', 's1', 'ready')$q$, '23503');
SELECT pg_temp.expect_error('revoked state needs revoked_at',
  $q$UPDATE mcp_connections SET auth_state = 'revoked', revision = revision + 1 WHERE id = 'c1'$q$, '23514');
SELECT pg_temp.expect_ok('revoked connection frees the live slot',
  $q$UPDATE mcp_connections SET auth_state = 'revoked', revoked_at = now(), revision = revision + 1 WHERE id = 'c1';
     INSERT INTO mcp_connections (id, actor_id, app_id, tenant_key, server_id, auth_state) VALUES ('c3', 'u1', 'a1', '', 's1', 'ready')$q$);
SELECT pg_temp.expect_error('unavailable usage has no counts',
  $q$INSERT INTO model_calls (id, run_id, step_id, actor_id, app_id, tenant_key, attempt, provider, model, usage_source, input_tokens, outcome)
     VALUES ('mc1', 'r1', 'step1', 'u1', 'a1', '', 1, 'p', 'm', 'unavailable', 0, 'pending')$q$, '23514');
SELECT pg_temp.expect_error('failed model call needs a failure code',
  $q$INSERT INTO model_calls (id, run_id, step_id, actor_id, app_id, tenant_key, attempt, provider, model, usage_source, outcome)
     VALUES ('mc1', 'r1', 'step1', 'u1', 'a1', '', 1, 'p', 'm', 'estimate', 'failed')$q$, '23514');
SELECT pg_temp.expect_ok('idempotency key stored',
  $q$INSERT INTO request_idempotency (actor_id, app_id, tenant_key, operation, idempotency_key, payload_fingerprint)
     VALUES ('u1', 'a1', '', 'runs.create', 'k1', repeat('c', 64))$q$);
SELECT pg_temp.expect_error('idempotency key is unique per owner and operation',
  $q$INSERT INTO request_idempotency (actor_id, app_id, tenant_key, operation, idempotency_key, payload_fingerprint)
     VALUES ('u1', 'a1', '', 'runs.create', 'k1', repeat('d', 64))$q$, '23505');
SELECT pg_temp.expect_ok('same key for another tenant is independent',
  $q$INSERT INTO request_idempotency (actor_id, app_id, tenant_key, operation, idempotency_key, payload_fingerprint)
     VALUES ('u1', 'a1', 't1', 'runs.create', 'k1', repeat('d', 64))$q$);

-- Fresh schema only: no legacy taxonomy tables and no foreign keys leaving viper_engine -----
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'viper_engine'
             AND table_name IN ('tools', 'knowledges', 'skills', 'intents', 'intent_examples', 'embeddings')) THEN
    RAISE EXCEPTION 'legacy taxonomy table present';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_class s ON s.oid = c.conrelid JOIN pg_namespace sn ON sn.oid = s.relnamespace
             WHERE c.contype = 'f' AND sn.nspname = 'viper_engine' AND n.nspname <> 'viper_engine') THEN
    RAISE EXCEPTION 'foreign key leaves the viper_engine schema';
  END IF;
  INSERT INTO results VALUES ('no legacy tables or external foreign keys');
END $$;

SELECT count(*) AS passed_checks FROM results;
ROLLBACK;
