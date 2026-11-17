/** Simulates one lost network connection after exactly one complete server frame. */
export function cutFirstStream() {
  let streams = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await globalThis.fetch(url, init);
    if (!String(url).endsWith('/events')) return response;
    streams++; if (streams > 1 || response.body === null) return response;
    const reader = response.body.getReader(); let pending = Buffer.alloc(0);
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) { controller.close(); return; }
          pending = Buffer.concat([pending, chunk.value]); const boundary = pending.indexOf('\n\n');
          if (pending.byteLength > 1048576) throw new Error('Fixture frame exceeded budget');
          if (boundary < 0) continue;
          controller.enqueue(pending.subarray(0, boundary + 2)); controller.close(); await reader.cancel(); return;
        }
      } catch (error) { controller.error(error); }
    }, async cancel() { await reader.cancel(); } });
    return new Response(stream, { status: response.status, headers: response.headers });
  };
  return { fetch, streams: () => streams };
}
