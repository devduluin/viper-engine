import type { AgentDialect } from '../postgres/agent-store.js';

/** The pool binds $1-style parameters by name, so shared queries can reuse one; timestamps are *_ms integers. */
export const SQLITE_AGENTS: AgentDialect = { param: n => `$${n}`, time: n => `$${n}`, column: name => `${name}_ms` };
