-- Client tools a run may use (e.g. read_page from the embed panel). NULL = none; names are validated by the API.
ALTER TABLE viper_engine.runs ADD COLUMN client_tools text[] NULL
  CONSTRAINT runs_client_tools_bounded CHECK (client_tools IS NULL OR cardinality(client_tools) <= 8);
