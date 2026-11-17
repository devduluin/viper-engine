import { EngineClientFailure } from '../../contracts/client/failure.js';

export const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

/** Cancellation is requested without awaiting an uncooperative stream's teardown promise. */
export function releaseReader(reader: { cancel(): Promise<void>; releaseLock(): void }): void {
  void reader.cancel().catch(() => undefined); reader.releaseLock();
}

async function bodyReader(response: Response, maximum: number) {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maximum) { await response.body?.cancel(); throw new EngineClientFailure('PAYLOAD_TOO_LARGE'); }
  const reader = response.body?.getReader(); if (reader === undefined) throw new EngineClientFailure('INVALID_RESPONSE');
  return reader;
}

export async function readJsonBody(response: Response, maximum: number, signal: AbortSignal): Promise<unknown> {
  const reader = await bodyReader(response, maximum);
  const abort = () => { void reader.cancel().catch(() => undefined); }; signal.addEventListener('abort', abort, { once: true });
  let bytes = 0; let text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      if (signal.aborted) throw new EngineClientFailure('CANCELLED');
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > maximum) throw new EngineClientFailure('PAYLOAD_TOO_LARGE');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) { if (error instanceof EngineClientFailure) throw error; throw new EngineClientFailure('INVALID_RESPONSE'); }
  finally { signal.removeEventListener('abort', abort); releaseReader(reader); }
}
