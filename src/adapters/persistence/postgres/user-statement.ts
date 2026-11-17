import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { NoteSource, SourceView } from '../../../contracts/recall/ports.js';
import { parseContent } from '../../../contracts/messages/parse-content.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { asRow, text, integer, ownerColumns, msColumn } from './rows.js';
import type { SqlQueryable } from './sql-client.js';

/** One source policy shared by explicit notes, feedback and reviewed promotions. */
export async function userStatement(tx: SqlQueryable, scope: TrustedScope, input: NoteSource): Promise<StateResult<{ readonly source: SourceView; readonly text: string }>> {
  const result = await tx.query(`SELECT role, content, position, ${msColumn('created_at')} FROM viper_engine.messages
    WHERE actor_id = $1 AND app_id = $2 AND tenant_key = $3 AND conversation_id = $4 AND id = $5`,
  [...ownerColumns(scope), input.conversationId, input.messageId]);
  if (result.rows[0] === undefined) return stateConflict({ code: 'not_found', message: 'Source not found' });
  const row = asRow(result.rows[0]); const blocks = parseContent(row['content']);
  if (text(row, 'role') !== 'user' || blocks.some(block => block.type !== 'text')) return stateConflict({ code: 'evidence_required', message: 'Select a user text statement explicitly' });
  const content = blocks.map(block => block.type === 'text' ? block.text : '').join('\n');
  if (content.trim() === '' || new TextEncoder().encode(content).byteLength > 8192) return stateConflict({ code: 'evidence_required', message: 'User statement requires 1..8192 bytes of text' });
  return stateOk({ text: content, source: Object.freeze({ ...input, role: 'user', position: integer(row, 'position'), createdAt: integer(row, 'created_at_ms') }) });
}
