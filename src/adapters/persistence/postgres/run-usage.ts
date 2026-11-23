import type { RunId } from '../../../contracts/identity/ids.js';
import type { RunUsage } from '../../../contracts/models/run-usage.js';
import type { SqlQueryable } from './sql-client.js';
import { asRow, integer, member } from './rows.js';

export async function runUsage(tx: SqlQueryable, runId: RunId): Promise<RunUsage> {
  const result = await tx.query(`SELECT count(*)::bigint AS calls, count(DISTINCT usage_source)::int AS sources,
    min(usage_source) AS single_source, count(input_tokens)::bigint AS input_count, sum(input_tokens) AS input_sum,
    count(output_tokens)::bigint AS output_count, sum(output_tokens) AS output_sum,
    count(total_tokens)::bigint AS total_count, sum(total_tokens) AS total_sum
    FROM viper_engine.model_calls WHERE run_id = $1`, [runId]);
  return decodeRunUsage(result.rows[0]);
}

export function decodeRunUsage(value: unknown): RunUsage {
  const row = asRow(value); const modelCalls = integer(row, 'calls'); const sources = integer(row, 'sources');
  const token = (kind: string) => modelCalls > 0 && integer(row, `${kind}_count`) === modelCalls ? integer(row, `${kind}_sum`) : null;
  const source = sources === 0 ? 'unavailable' : sources > 1 ? 'mixed'
    : member(row, 'single_source', ['provider', 'estimate', 'unavailable'] as const);
  return { modelCalls, source, inputTokens: token('input'), outputTokens: token('output'), totalTokens: token('total') };
}
