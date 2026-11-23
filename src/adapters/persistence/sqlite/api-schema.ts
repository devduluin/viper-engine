export const API_SPIKE_SCHEMA = `
CREATE INDEX viper_engine.conversations_owner_recent ON conversations
  (actor_id, app_id, tenant_key, updated_at_ms DESC, id DESC) WHERE deleted_at_ms IS NULL;
CREATE INDEX viper_engine.runs_conversation_recent ON runs (conversation_id, created_at_ms DESC, id DESC);
CREATE TABLE viper_engine.run_instructions (
  run_id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  messages TEXT NOT NULL CHECK (json_valid(messages) AND json_type(messages) = 'array'
    AND length(CAST(messages AS BLOB)) <= 262144),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES runs(id, actor_id, app_id, tenant_key)
) STRICT;
CREATE TABLE viper_engine.input_receipts (
  run_id TEXT NOT NULL, actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL, input_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  response TEXT NOT NULL CHECK (json_valid(response) AND json_type(response) = 'object'
    AND length(CAST(response AS BLOB)) <= 8192),
  PRIMARY KEY (run_id, input_id),
  FOREIGN KEY (run_id, actor_id, app_id, tenant_key) REFERENCES runs(id, actor_id, app_id, tenant_key)
) STRICT;
CREATE TRIGGER viper_engine.instructions_immutable BEFORE UPDATE ON run_instructions
BEGIN SELECT RAISE(ABORT, 'instructions are immutable'); END;
CREATE TRIGGER viper_engine.receipts_immutable BEFORE UPDATE ON input_receipts
BEGIN SELECT RAISE(ABORT, 'input receipt is immutable'); END;
`;
