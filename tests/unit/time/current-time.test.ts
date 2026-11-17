import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCurrentTime } from '../../../src/shared/time/current-time.js';

const AUG_4_2026_0735_UTC = Date.UTC(2026, 7, 4, 7, 35);
const NOV_15_2026_1700_UTC = Date.UTC(2026, 10, 15, 17, 0);
const LEAP_DAY_2024_LATE = Date.UTC(2024, 1, 29, 16, 59, 59);
const JAN_15_2026_1200_UTC = Date.UTC(2026, 0, 15, 12, 0);

function jakarta(instant: number): string {
  return describeCurrentTime({ instant, timeZone: 'Asia/Jakarta', locale: 'id-ID' });
}

function assertParts(text: string, parts: readonly string[]): void {
  for (const part of parts) assert.ok(text.includes(part), `${JSON.stringify(text)} lacks ${part}`);
}

test('id-ID Asia/Jakarta keeps legacy weekday, date, 24h time and WIB label', () => {
  // Legacy: "Selasa, 4 Agustus 2026, pukul 14.35 WIB", "Kamis, 29 Februari 2024, pukul 23.59 WIB".
  assertParts(jakarta(AUG_4_2026_0735_UTC), ['Selasa', '4 Agustus 2026', '14.35', 'WIB']);
  assertParts(jakarta(LEAP_DAY_2024_LATE), ['Kamis', '29 Februari 2024', '23.59', 'WIB']);
});

test('UTC and Jakarta differ across the date boundary for the same instant', () => {
  assertParts(jakarta(NOV_15_2026_1700_UTC), ['Senin', '16 November 2026', '00.00', 'WIB']);
  const utc = describeCurrentTime({ instant: NOV_15_2026_1700_UTC, timeZone: 'UTC', locale: 'id-ID' });
  assertParts(utc, ['Minggu', '15 November 2026', '17.00', 'UTC']);
});

test('zone label is derived from the zone instead of always WIB', () => {
  const at = AUG_4_2026_0735_UTC;
  const makassar = describeCurrentTime({ instant: at, timeZone: 'Asia/Makassar', locale: 'id-ID' });
  const jayapura = describeCurrentTime({ instant: at, timeZone: 'Asia/Jayapura', locale: 'id-ID' });
  assertParts(makassar, ['15.35', 'WITA']);
  assertParts(jayapura, ['16.35', 'WIT']);
  assert.ok(!makassar.includes('WIB') && !jayapura.includes('WIB'));
});

test('DST zones resolve the offset and label of the supplied instant', () => {
  const zone = { timeZone: 'America/New_York', locale: 'en-US' };
  const summer = describeCurrentTime({ instant: AUG_4_2026_0735_UTC, ...zone });
  const winter = describeCurrentTime({ instant: JAN_15_2026_1200_UTC, ...zone });
  assertParts(summer, ['Tuesday', 'August 4, 2026', '03:35', 'EDT']);
  assertParts(winter, ['Thursday', 'January 15, 2026', '07:00', 'EST']);
});

test('output is deterministic and independent of the host time zone', () => {
  const previous = process.env['TZ'];
  const expected = jakarta(AUG_4_2026_0735_UTC);
  try {
    for (const hostZone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env['TZ'] = hostZone;
      assert.equal(jakarta(AUG_4_2026_0735_UTC), expected);
    }
  } finally {
    if (previous === undefined) delete process.env['TZ'];
    else process.env['TZ'] = previous;
  }
});

test('invalid instants, time zones and locales are rejected explicitly', () => {
  const base = { instant: AUG_4_2026_0735_UTC, timeZone: 'Asia/Jakarta', locale: 'id-ID' };
  const badInstants: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1, '0'];
  for (const instant of badInstants) {
    assert.throws(() => describeCurrentTime({ ...base, instant: instant as number }), /Invalid instant/);
  }
  for (const timeZone of ['', 'Mars/Olympus', 'Jakarta']) {
    assert.throws(() => describeCurrentTime({ ...base, timeZone }), /Invalid time zone/);
  }
  for (const locale of ['', '!!', 'en_US']) {
    assert.throws(() => describeCurrentTime({ ...base, locale }), /Invalid locale/);
  }
});
