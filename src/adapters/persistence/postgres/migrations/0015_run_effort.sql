-- Per-run reasoning effort chosen by the user (composer: Cepat/Seimbang/Mendalam). NULL = host default.
ALTER TABLE viper_engine.runs ADD COLUMN effort text NULL
  CONSTRAINT runs_effort_known CHECK (effort IN ('low', 'medium', 'high'));
