/** S0 message schema. Apply after RUN_SPIKE_SCHEMA. */
export const MESSAGE_SPIKE_SCHEMA = `
CREATE TABLE viper_engine.messages (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL, app_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL, run_id TEXT,
  position INTEGER NOT NULL CHECK (position >= 1),
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL CHECK (json_valid(content) AND json_type(content) = 'array' AND length(CAST(content AS BLOB)) <= 262144),
  tool_calls TEXT CHECK (tool_calls IS NULL OR (json_valid(tool_calls) AND json_type(tool_calls) = 'array' AND length(CAST(tool_calls AS BLOB)) <= 262144)),
  tool_call_id TEXT, outcome TEXT CHECK (outcome IN ('success', 'error', 'unknown')),
  created_at_ms INTEGER NOT NULL,
  CHECK ((role = 'tool') = (tool_call_id IS NOT NULL) AND (role = 'tool') = (outcome IS NOT NULL)),
  CHECK (tool_calls IS NULL OR role = 'assistant'),
  UNIQUE (conversation_id, position),
  FOREIGN KEY (conversation_id, actor_id, app_id, tenant_key)
    REFERENCES conversations (id, actor_id, app_id, tenant_key),
  FOREIGN KEY (run_id, conversation_id, actor_id, app_id, tenant_key)
    REFERENCES runs (id, conversation_id, actor_id, app_id, tenant_key)
) STRICT;
CREATE UNIQUE INDEX viper_engine.messages_one_tool_result
  ON messages (conversation_id, tool_call_id) WHERE role = 'tool';
CREATE INDEX viper_engine.messages_run ON messages (run_id) WHERE run_id IS NOT NULL;
CREATE TRIGGER viper_engine.message_append_only BEFORE UPDATE ON messages
BEGIN SELECT RAISE(ABORT, 'message is immutable'); END;
`;
