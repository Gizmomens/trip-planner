import { describe, expect, it } from 'vitest';
import { dateLabel, dateTime, duration, logTime, miles, time } from '../src/lib/format';
import { tomtomTileUrl } from '../src/lib/api';

describe('fixed assessment display', () => {
  it('uses UTC-06:00 even across the UTC date boundary and daylight saving dates', () => {
    expect(time('2026-07-02T02:30:00Z')).toBe('20:30');
    expect(dateTime('2026-07-02T02:30:00Z')).toContain('Jul 1');
    expect(time('2026-01-02T14:00:00Z')).toBe('08:00');
    expect(time('2026-07-02T06:00:00Z')).toBe('00:00');
    expect(dateLabel('2026-07-02')).toContain('Jul 2');
  });
  it('preserves second-level duration and actual miles', () => {
    expect(miles(1609.344)).toBe('1');
    expect(duration(3661)).toBe('1h 1m 1s');
    expect(duration(86400)).toBe('24h 0m');
    expect(logTime(86400)).toBe('24:00');
    expect(logTime(28801)).toBe('08:00:01');
  });
});

describe('public TomTom tile boundary', () => {
  it('uses only the fixed HTTPS raster endpoint and validates the public key', () => {
    expect(tomtomTileUrl('')).toBeNull();
    expect(tomtomTileUrl('https://untrusted.invalid/key')).toBeNull();
    expect(tomtomTileUrl('invalid&other=parameter')).toBeNull();
    expect(tomtomTileUrl('public_test_key_12345')).toBe(
      'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=public_test_key_12345',
    );
  });
});
