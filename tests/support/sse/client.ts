import assert from 'node:assert/strict';
import { withDeadline } from '../../../src/shared/async/deadline.js';
import { parseFrame } from './frames.js';
import type { SseFrame } from './frames.js';

/** Real HTTP stream reader; aborts pending reads on timeout/close so tests leave no sockets. */
export async function sseClient(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { authorization: 'Bearer owner', ...headers }, signal: controller.signal });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = response.body?.getReader(); assert.ok(reader); const decoder = new TextDecoder();
  let buffer = ''; const comments: string[] = [];
  const nextRaw = async (): Promise<string | undefined> => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) { const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); return frame; }
      const chunk = await reader.read(); if (chunk.done) return undefined;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
  const next = async (): Promise<SseFrame | undefined> => {
    try {
      return await withDeadline(async () => {
        for (;;) {
          const raw = await nextRaw(); if (raw === undefined) return undefined;
          if (raw.startsWith(':')) comments.push(raw);
          const frame = parseFrame(raw); if (frame !== undefined) return frame;
        }
      }, { operationName: 'SSE client frame', timeoutMs: 15000 });
    } catch (error) { controller.abort(); throw error; }
  };
  return { response, comments, next, nextRaw: async () => {
    try { return await withDeadline(() => nextRaw(), { operationName: 'SSE raw frame', timeoutMs: 15000 }); }
    catch (error) { controller.abort(); throw error; }
  },
    async close() { controller.abort(); await reader.cancel().catch(() => undefined); } };
}
