-- Conversation deletion (user-facing "Hapus percakapan"): a soft delete. The conversation leaves the
-- history list and cannot be read or continued; runs, tool calls, approvals and events stay for audit.
ALTER TABLE viper_engine.conversations ADD COLUMN deleted_at timestamptz NULL;
