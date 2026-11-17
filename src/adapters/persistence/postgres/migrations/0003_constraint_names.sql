-- P04-01 review correction: stable names for constraints the repositories map to StateResult
-- conflicts. Auto-generated names are truncated at 63 bytes and must not be matched by prefix.
ALTER TABLE viper_engine.tool_calls
  RENAME CONSTRAINT "tool_calls_connection_id_server_id_actor_id_app_id_tenant__fkey" TO tool_calls_caller_connection_fk;
