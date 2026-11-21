import type { RecallNote, RecallPage, RecallStore } from '../../contracts/recall/ports.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { recallQuery } from '../../contracts/recall/validation.js';

export interface RelevantNoteQuery {
  readonly query: string;
  readonly limit?: number;
  /** Serialized selected notes, including their provenance; excludes transport envelope. */
  readonly maxBytes?: number;
}

function tokens(text: string): ReadonlySet<string> {
  return new Set((text.normalize('NFKD').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 1));
}

function ranked(notes: readonly RecallNote[], query: ReadonlySet<string>) {
  const documents = notes.filter(note => note.status === 'active' && note.text !== undefined && note.source !== undefined)
    .map(note => ({ note, words: tokens(note.text ?? '') }));
  const frequency = new Map([...query].map(term => [term, documents.filter(item => item.words.has(term)).length]));
  return documents.map(item => ({ note: item.note, score: [...query].reduce((score, term) =>
    score + (item.words.has(term) ? Math.log(1 + documents.length / (1 + (frequency.get(term) ?? 0))) : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt
      || a.note.noteId.localeCompare(b.note.noteId));
}

/** Explicit host/model-requested retrieval; never promotes behavior or injects notes by itself. */
export async function relevantNotes(store: RecallStore, scope: TrustedScope, input: RelevantNoteQuery): Promise<RecallPage<RecallNote>> {
  const { query, limit, maximum } = settings(input);
  // Search the scoped corpus, not only the newest 50 notes. At most six literal term searches,
  // each with 50 candidates, bound storage work independently of the model output budget.
  const terms = [...tokens(query)].slice(0, 6);
  const pages = await Promise.all(terms.map(term => store.notes(scope, { query: term, limit: 50 })));
  const candidates = new Map(pages.flatMap(page => page.items).map(note => [note.noteId, note]));
  const matches = ranked([...candidates.values()], tokens(query));
  const selected = withinBudget(matches.map(match => match.note), limit, maximum);
  return Object.freeze({ schemaVersion: 1, items: Object.freeze(selected),
    hasMore: pages.some(page => page.hasMore) || selected.length < matches.length });
}

function settings(input: RelevantNoteQuery) {
  const query = recallQuery(input.query); const limit = input.limit ?? 5; const maximum = input.maxBytes ?? 4096;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new RangeError('Relevant notes limit must be 1..10');
  if (!Number.isSafeInteger(maximum) || maximum < 512 || maximum > 16384) throw new RangeError('Relevant notes byte budget must be 512..16384');
  return { query, limit, maximum };
}

function withinBudget(notes: readonly RecallNote[], limit: number, maximum: number) {
  const selected: RecallNote[] = [];
  for (const note of notes) {
    if (selected.length >= limit) break;
    const bytes = new TextEncoder().encode(JSON.stringify([...selected, note])).byteLength;
    if (bytes <= maximum) selected.push(note);
  }
  return selected;
}
