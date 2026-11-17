// Provenance: ai-intent-api-v2/src/utils/current-datetime.util.ts
// SHA-256 17eb1ab4fdc499c12f791b2fe3db0fa557d0f0b1e5da329c81b4b014aea0208b (P02-03 adaptation).
// Changes: injected instant, explicit locale/IANA zone, ICU-derived zone label instead of fixed WIB.

const MAX_EPOCH_MS = 8.64e15;

export interface CurrentTimeOptions {
  /** Epoch milliseconds supplied by composition, e.g. from Clock.now(). */
  readonly instant: number;
  /** IANA time zone from trusted request/application context, e.g. Asia/Jakarta. */
  readonly timeZone: string;
  /** BCP 47 locale chosen by application configuration, e.g. id-ID. */
  readonly locale: string;
}

/**
 * Formats one locale-native grounding sentence for a supplied instant, for example
 * "Selasa, 4 Agustus 2026 pukul 14.35 WIB". Output never depends on the host time zone.
 */
export function describeCurrentTime(options: CurrentTimeOptions): string {
  const date = toDate(options.instant);
  const locale = canonicalLocale(options.locale);
  assertTimeZone(options.timeZone);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: options.timeZone,
    timeZoneName: 'short',
  }).format(date);
}

function toDate(instant: unknown): Date {
  if (typeof instant !== 'number' || !Number.isFinite(instant) || Math.abs(instant) > MAX_EPOCH_MS) {
    throw new RangeError('Invalid instant: expected finite epoch milliseconds');
  }
  return new Date(instant);
}

function canonicalLocale(locale: unknown): string {
  if (typeof locale !== 'string' || locale.length === 0) throw new RangeError('Invalid locale');
  try {
    const [canonical] = Intl.getCanonicalLocales(locale);
    if (canonical === undefined) throw new RangeError('Invalid locale');
    return canonical;
  } catch {
    throw new RangeError(`Invalid locale: ${locale}`);
  }
}

function assertTimeZone(timeZone: unknown): void {
  if (typeof timeZone !== 'string' || timeZone.length === 0) throw new RangeError('Invalid time zone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new RangeError(`Invalid time zone: ${timeZone}`);
  }
}
