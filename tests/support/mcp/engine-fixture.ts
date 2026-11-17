import type { FixtureOptions } from './fixture-server.js';

/** Opt-in side-effect/content fixtures; defaults used by earlier contract suites stay unchanged. */
export function engineFixture(): FixtureOptions & { readonly writes: () => number; readonly calls: readonly string[] } {
  let writes = 0;
  const calls: string[] = [];
  return {
    writes: () => writes,
    calls, onCall: name => { calls.push(name); },
    extraTools: [
      { name: 'record_write', description: 'Record the approved amount', annotations: { destructiveHint: true },
        inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['count'], additionalProperties: false } },
      { name: 'rich_result', description: 'Return multimodal evidence', inputSchema: { type: 'object' } },
      { name: 'audio_result', description: 'Return audio evidence', inputSchema: { type: 'object' } },
    ],
    handlers: {
      record_write: args => {
        writes += 1;
        return { content: [{ type: 'text', text: 'Write recorded' }], structuredContent: { writes, count: args['count'] } };
      },
      rich_result: () => ({ content: [
        { type: 'text', text: 'Visible evidence' }, { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
        { type: 'resource', resource: { uri: 'fixture://note', text: 'Embedded evidence' } },
        { type: 'resource_link', name: 'Evidence reference', uri: 'fixture://reference' },
      ], structuredContent: { confirmed: true }, _meta: { secret: 'PRIVATE_MCP_META' } }),
      audio_result: () => ({ content: [{ type: 'audio', mimeType: 'audio/wav', data: 'aGVsbG8=' }] }),
    },
  };
}
