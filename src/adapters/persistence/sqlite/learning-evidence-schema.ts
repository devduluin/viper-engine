export const LEARNING_EVIDENCE_SCHEMA = `
CREATE VIEW viper_engine.learning_user_statements AS
SELECT m.id, m.conversation_id, m.actor_id, m.app_id, m.tenant_key, m.position,
  (SELECT group_concat(json_extract(b.value, '$.text'), char(10) ORDER BY b.key) FROM json_each(m.content) b) AS statement
FROM messages m WHERE m.role = 'user'
  AND NOT EXISTS (SELECT 1 FROM json_each(m.content) b WHERE json_extract(b.value, '$.type') IS NOT 'text');

CREATE VIEW viper_engine.learning_eligible AS
SELECT r.id AS run_id, m.id AS final_message_id FROM runs r
JOIN runtime_checkpoints c ON c.run_id = r.id
JOIN messages m ON m.run_id = r.id AND m.position = (SELECT max(position) FROM messages WHERE run_id = r.id)
WHERE r.status = 'completed' AND json_extract(c.state, '$.version') = 1
  AND json_extract(c.state, '$.phase') = 'final' AND json_type(c.state, '$.modelPending') = 'false'
  AND m.role = 'assistant' AND m.tool_calls IS NULL AND json_array_length(m.content) > 0
  AND (SELECT count(*) FROM model_calls WHERE run_id = r.id) BETWEEN 1 AND 1000
  AND NOT EXISTS (SELECT 1 FROM model_calls WHERE run_id = r.id AND (outcome <> 'succeeded' OR ended_at_ms IS NULL))
  AND (SELECT count(*) FROM tool_calls WHERE run_id = r.id) <= 1000
  AND (SELECT count(*) FROM tool_call_attempts WHERE run_id = r.id) <= 2000
  AND NOT EXISTS (SELECT 1 FROM tool_calls WHERE run_id = r.id AND status <> 'succeeded')
  AND NOT EXISTS (SELECT 1 FROM tool_calls t WHERE t.run_id = r.id AND (
    t.attempts <> (SELECT count(*) FROM tool_call_attempts WHERE run_id = t.run_id AND tool_call_id = t.id)
    OR t.attempts <> (SELECT coalesce(max(attempt), 0) FROM tool_call_attempts WHERE run_id = t.run_id AND tool_call_id = t.id)))
  AND NOT EXISTS (SELECT 1 FROM tool_call_attempts WHERE run_id = r.id AND result_kind IS NOT 'succeeded');
`;
