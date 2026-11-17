-- X01: provider prompt-cache usage per model call. input_tokens stays the whole prompt;
-- these are the cached parts of it (NULL when the provider did not report them).
ALTER TABLE viper_engine.model_calls
  ADD COLUMN cache_read_tokens bigint NULL CONSTRAINT model_calls_cache_read_nonnegative CHECK (cache_read_tokens >= 0),
  ADD COLUMN cache_write_tokens bigint NULL CONSTRAINT model_calls_cache_write_nonnegative CHECK (cache_write_tokens >= 0),
  ADD CONSTRAINT model_calls_cache_within_input CHECK (
    input_tokens IS NULL OR coalesce(cache_read_tokens, 0) + coalesce(cache_write_tokens, 0) <= input_tokens),
  ADD CONSTRAINT model_calls_cache_unavailable CHECK (
    usage_source <> 'unavailable' OR num_nonnulls(cache_read_tokens, cache_write_tokens) = 0);
