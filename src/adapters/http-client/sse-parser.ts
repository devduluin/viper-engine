import { EngineClientFailure } from '../../contracts/client/failure.js';
import { utf8Bytes } from './body.js';

export interface RawSseFrame { readonly id?: string; readonly type?: string; readonly data: string }
/** Per-frame budget and line-ending state; caller feeds bounded decoded chunks. No global event queue. */
export class SseParser {
  private pending = ''; private bytes = 0; private data: string[] = [];
  private id: string | undefined; private type: string | undefined;
  constructor(private readonly maximum: number) {}

  feed(text: string): readonly RawSseFrame[] {
    this.pending += text; const frames: RawSseFrame[] = [];
    for (;;) {
      const index = this.pending.search(/[\r\n]/);
      if (index < 0 || (this.pending[index] === '\r' && index === this.pending.length - 1)) break;
      const length = this.pending[index] === '\r' && this.pending[index + 1] === '\n' ? 2 : 1;
      const line = this.pending.slice(0, index); this.pending = this.pending.slice(index + length);
      this.bytes += utf8Bytes(line) + length;
      if (this.bytes > this.maximum) throw new EngineClientFailure('PAYLOAD_TOO_LARGE');
      const frame = this.line(line); if (frame !== undefined) frames.push(frame);
    }
    if (this.bytes + utf8Bytes(this.pending) > this.maximum) throw new EngineClientFailure('PAYLOAD_TOO_LARGE');
    return frames;
  }
  finish(): readonly RawSseFrame[] { return this.pending.endsWith('\r') ? this.feed('\n') : []; }

  private line(line: string): RawSseFrame | undefined {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':'); const field = colon < 0 ? line : line.slice(0, colon);
    const raw = colon < 0 ? '' : line.slice(colon + 1); const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.type = value;
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    return undefined;
  }

  private dispatch(): RawSseFrame | undefined {
    const frame = this.data.length === 0 ? undefined : { data: this.data.join('\n'),
      ...(this.id === undefined ? {} : { id: this.id }), ...(this.type === undefined ? {} : { type: this.type }) };
    this.bytes = 0; this.data = []; this.id = undefined; this.type = undefined; return frame;
  }
}
