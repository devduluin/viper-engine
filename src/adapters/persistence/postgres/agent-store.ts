import { parseId } from '../../../contracts/identity/ids.js';
import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { AgentChildInput, AgentChildRecord, AgentRunStore, RunLineage } from '../../../contracts/state/agents.js';
import { isTerminalRunStatus, RUN_STATUSES } from '../../../contracts/state/run-state.js';
import type { RunStatus } from '../../../contracts/state/run-state.js';
import { asRow, MS_PARAM, ownerColumns } from './rows.js';
import type { SqlQueryable } from './sql-client.js';

/** The two drivers differ only in placeholders and timestamp columns; the queries are shared. */
export interface AgentDialect {
  /** Placeholder for parameter n. */
  readonly param: (n: number) => string;
  /** A millisecond parameter written to a timestamp column. */
  readonly time: (n: number) => string;
  /** Column name of a timestamp. */
  readonly column: (name: string) => string;
}
export const POSTGRES_AGENTS: AgentDialect = { param: n => `$${n}`, time: MS_PARAM, column: name => name };

const TERMINAL = "('completed', 'partial', 'failed', 'cancelled')";
const OWNER = (p: AgentDialect, first: number) => `actor_id = ${p.param(first)} AND app_id = ${p.param(first + 1)} AND tenant_key = ${p.param(first + 2)}`;

export class SqlAgentRunStore implements AgentRunStore {
  constructor(private readonly db: SqlQueryable, private readonly d: AgentDialect = POSTGRES_AGENTS) {}

  async lineage(scope: TrustedScope, runId: RunId): Promise<RunLineage | undefined> {
    const row = (await this.db.query(`SELECT id, conversation_id, coalesce(root_run_id, id) AS root, depth, status
      FROM viper_engine.runs WHERE id = ${this.d.param(1)} AND ${OWNER(this.d, 2)}`, [runId, ...ownerColumns(scope)])).rows[0];
    if (row === undefined) return undefined;
    const r = asRow(row);
    return Object.freeze({ runId: parseId('run', r['id']), conversationId: parseId('conversation', r['conversation_id']),
      rootRunId: parseId('run', r['root']), depth: Number(r['depth']), status: status(r['status']) });
  }

  async findSpawn(scope: TrustedScope, parentRunId: RunId, spawnKey: string) {
    const rows = await this.select(scope, `parent_run_id = ${this.d.param(4)} AND spawn_key = ${this.d.param(5)}`, [parentRunId, spawnKey]);
    return rows[0];
  }

  async treeCounts(scope: TrustedScope, rootRunId: RunId) {
    const row = asRow((await this.db.query(`SELECT count(*) AS total,
        coalesce(sum(CASE WHEN status NOT IN ${TERMINAL} THEN 1 ELSE 0 END), 0) AS live
      FROM viper_engine.runs WHERE root_run_id = ${this.d.param(4)} AND ${OWNER(this.d, 1)}`, [...ownerColumns(scope), rootRunId])).rows[0]);
    return Object.freeze({ live: Number(row['live']), total: Number(row['total']) });
  }

  async createChild(scope: TrustedScope, input: AgentChildInput): Promise<AgentChildRecord> {
    const owner = ownerColumns(scope); const p = this.d.param; const at = this.d.time;
    await this.db.query(`INSERT INTO viper_engine.conversations (id, actor_id, app_id, tenant_key, title, kind, parent_conversation_id,
        ${this.d.column('created_at')}, ${this.d.column('updated_at')})
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, 'agent', ${p(6)}, ${at(7)}, ${at(7)})`,
    [input.conversationId, ...owner, input.title, input.parent.conversationId, input.at]);
    await this.db.query(`INSERT INTO viper_engine.runs (id, actor_id, app_id, tenant_key, conversation_id, status,
        ${this.d.column('created_at')}, ${this.d.column('updated_at')}, parent_run_id, root_run_id, depth, agent_profile, spawn_key)
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, 'queued', ${at(6)}, ${at(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)})`,
    [input.runId, ...owner, input.conversationId, input.at, input.parent.runId, input.parent.rootRunId,
      input.parent.depth + 1, input.profile, input.spawnKey]);
    await this.link(owner, input.linkId, input.parent.runId, input.runId, 'spawned', input.at, false);
    return Object.freeze({ runId: input.runId, conversationId: input.conversationId, profile: input.profile,
      spawnKey: input.spawnKey, status: 'queued' as const });
  }

  async children(scope: TrustedScope, parentRunId: RunId) {
    return this.select(scope, `parent_run_id = ${this.d.param(4)}`, [parentRunId]);
  }

  async awaitChildren(scope: TrustedScope, parentRunId: RunId, links: readonly { linkId: string; childRunId: RunId }[], at: number) {
    const owner = ownerColumns(scope);
    const known = new Map((await this.children(scope, parentRunId)).map(child => [child.runId, child]));
    for (const { linkId, childRunId } of links) {
      const child = known.get(childRunId);
      if (child === undefined) throw new Error('Only a child of this run can be awaited');
      const exists = await this.db.query(`SELECT 1 FROM viper_engine.run_links WHERE from_run_id = ${this.d.param(1)}
        AND to_run_id = ${this.d.param(2)} AND kind = 'awaits'`, [parentRunId, childRunId]);
      if (exists.rows.length === 0) await this.link(owner, linkId, parentRunId, childRunId, 'awaits', at, isTerminalRunStatus(child.status));
    }
    const open = asRow((await this.db.query(`SELECT count(*) AS n FROM viper_engine.run_links WHERE from_run_id = ${this.d.param(1)}
      AND kind = 'awaits' AND ${this.d.column('satisfied_at')} IS NULL`, [parentRunId])).rows[0]);
    return Number(open['n']);
  }

  async finalText(scope: TrustedScope, child: AgentChildRecord, maxBytes: number) {
    const row = (await this.db.query(`SELECT content FROM viper_engine.messages WHERE conversation_id = ${this.d.param(1)}
      AND role = 'assistant' AND ${OWNER(this.d, 2)} ORDER BY position DESC LIMIT 1`, [child.conversationId, ...ownerColumns(scope)])).rows[0];
    if (row === undefined) return '';
    const raw = asRow(row)['content'];
    const blocks: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const text = (Array.isArray(blocks) ? blocks : [])
      .flatMap(block => typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text'
        ? [String((block as { text?: unknown }).text ?? '')] : []).join('\n');
    return truncateBytes(text, maxBytes);
  }

  private async link(owner: readonly string[], id: string, from: RunId, to: RunId, kind: 'spawned' | 'awaits', at: number, satisfied: boolean) {
    const p = this.d.param; const time = this.d.time;
    await this.db.query(`INSERT INTO viper_engine.run_links (id, from_run_id, to_run_id, actor_id, app_id, tenant_key, kind,
        ${this.d.column('created_at')}, ${this.d.column('satisfied_at')})
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${time(8)}, ${satisfied ? time(8) : 'NULL'})`,
    [id, from, to, ...owner, kind, at]);
  }

  private async select(scope: TrustedScope, where: string, values: readonly unknown[]): Promise<readonly AgentChildRecord[]> {
    const result = await this.db.query(`SELECT id, conversation_id, agent_profile, spawn_key, status FROM viper_engine.runs
      WHERE ${OWNER(this.d, 1)} AND ${where} ORDER BY ${this.d.column('created_at')}, id`, [...ownerColumns(scope), ...values]);
    return result.rows.map(value => {
      const r = asRow(value);
      return Object.freeze({ runId: parseId('run', r['id']), conversationId: parseId('conversation', r['conversation_id']),
        profile: String(r['agent_profile']), spawnKey: String(r['spawn_key']), status: status(r['status']) });
    });
  }
}

function status(value: unknown): RunStatus {
  const found = RUN_STATUSES.find(item => item === value);
  if (found === undefined) throw new Error('Unknown run status');
  return found;
}

/** Cuts on a code point boundary and says so, so a parent never mistakes a cut report for a complete one. */
export function truncateBytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  const marker = '\n[... truncated]';
  let cut = new TextDecoder().decode(bytes.slice(0, Math.max(0, maxBytes - marker.length)));
  if (cut.endsWith('�')) cut = cut.slice(0, -1);
  return cut + marker;
}
