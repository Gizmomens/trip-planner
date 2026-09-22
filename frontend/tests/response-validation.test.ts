import { describe, expect, it } from 'vitest';
import { isBootstrap, isLocationsResponse, isTrip } from '../src/lib/response-validation';
import { bootstrap, day, locations, trip } from './fixtures';

describe('bootstrap response shape', () => {
  it('accepts an unconfigured provider, empty public key, and no assumptions', () => {
    expect(isBootstrap({ ...bootstrap, provider_ready: false, map_key: '', assumptions: [] })).toBe(
      true,
    );
  });

  it.each([
    { csrf_token: '' },
    { planning_token: ' ' },
    { departure_at: 'not-a-date' },
    { departure_at: '2026-09-21T08:00:00' },
    { departure_at: '2026-02-30T08:00:00-06:00' },
    { departure_at: '2026-09-21T25:00:00-06:00' },
    { time_basis: null },
    { map_key: null },
    { provider_ready: 'true' },
    { assumptions: [{ ...bootstrap.assumptions[0], detail: null }] },
    { limits: { ...bootstrap.limits, days: '30' } },
    { limits: { ...bootstrap.limits, facilities: NaN } },
    { limits: { ...bootstrap.limits, provider_requests: Infinity } },
    { limits: { ...bootstrap.limits, processing_seconds: undefined } },
  ])('rejects malformed fields: %j', (change) => {
    expect(isBootstrap({ ...bootstrap, ...change })).toBe(false);
  });
});

describe('selectable location response shape', () => {
  it('accepts empty lookup results and complete signed results', () => {
    expect(isLocationsResponse({ locations: [] })).toBe(true);
    expect(isLocationsResponse({ locations })).toBe(true);
  });

  it.each([
    { token: undefined },
    { token: null },
    { token: '' },
    { token: '   ' },
    { id: null },
    { name: {} },
    { address: [] },
    { lat: NaN },
    { lon: -Infinity },
    { lat: '41.88' },
    { kind: undefined },
  ])('rejects an unusable lookup entry: %j', (change) => {
    expect(isLocationsResponse({ locations: [{ ...locations[0], ...change }] })).toBe(false);
  });
});

describe('trip response structure', () => {
  it('accepts the complete fixture without mutating it', () => {
    const input = structuredClone(trip);
    expect(isTrip(input)).toBe(true);
    expect(input).toEqual(trip);
  });

  it('permits optional tokens throughout trip locations, stops, and activities', () => {
    const input = structuredClone(trip);
    for (const location of input.locations) delete location.token;
    for (const activity of input.activities) {
      delete activity.start_location.token;
      delete activity.end_location.token;
    }
    for (const stop of input.stops) delete stop.location.token;
    expect(isTrip(input)).toBe(true);
  });

  it('accepts valid empty arrays rather than requiring a particular trip topology', () => {
    expect(
      isTrip({
        ...trip,
        locations: [],
        activities: [],
        stops: [],
        route: { geometry: [], instructions: [] },
        days: [],
        assumptions: [],
        warnings: [],
      }),
    ).toBe(true);
    expect(
      isTrip({
        ...trip,
        stops: [{ ...trip.stops[0], purposes: [], activity_ids: [] }],
        days: [{ ...day, segments: [], remarks: [] }],
      }),
    ).toBe(true);
  });

  it('does not invent purpose, facility, cycle-balance, or business-rule restrictions', () => {
    expect(
      isTrip({
        ...trip,
        locations: [{ ...locations[0], kind: 'new-provider-kind', address: '' }],
        activities: [{ ...trip.activities[0], purpose: 'future_supported_purpose' }],
        summary: { ...trip.summary, cycle_remaining_hours: -0.25 },
        days: [
          {
            ...day,
            totals: { ...day.totals, off_duty: 0 },
            remarks: [{ time: '24:00', location: '', purpose: 'other', status: 'off_duty' }],
          },
        ],
        extra_metadata: { version: 2 },
      }),
    ).toBe(true);
  });

  it.each([
    '2026-09-21T14:00:00Z',
    '2026-09-21T08:00:00.123456-06:00',
    '2026-09-21T08:00+02:30',
    '2028-02-29T08:00:00-06:00',
  ])('accepts a valid explicit-offset timestamp: %s', (timestamp) => {
    expect(isTrip({ ...trip, departure_at: timestamp })).toBe(true);
  });

  it.each([
    ['summary', { summary: undefined }],
    ['summary field', { summary: { ...trip.summary, elapsed_seconds: '18000' } }],
    ['summary Infinity', { summary: { ...trip.summary, cycle_remaining_hours: Infinity } }],
    ['warnings', { warnings: [null] }],
    ['assumption title', { assumptions: [{ ...bootstrap.assumptions[0], title: 1 }] }],
    ['location record', { locations: [null] }],
    ['location name', { locations: [{ ...locations[0], name: {} }] }],
    ['location token', { locations: [{ ...locations[0], token: 5 }] }],
    ['arrival timestamp', { arrival_at: '2026-09-21' }],
    ['activity status', { activities: [{ ...trip.activities[0], status: 'sleeping' }] }],
    ['activity purpose', { activities: [{ ...trip.activities[0], purpose: null }] }],
    ['activity start time', { activities: [{ ...trip.activities[0], start_at: 'invalid' }] }],
    [
      'activity end time',
      { activities: [{ ...trip.activities[0], end_at: '2026-02-30T08:00:00Z' }] },
    ],
    ['activity start location', { activities: [{ ...trip.activities[0], start_location: {} }] }],
    ['activity end location', { activities: [{ ...trip.activities[0], end_location: null }] }],
    ['activity distance', { activities: [{ ...trip.activities[0], distance_meters: NaN }] }],
    ['stop arrival', { stops: [{ ...trip.stops[0], arrival_at: 'invalid' }] }],
    ['stop departure', { stops: [{ ...trip.stops[0], departure_at: '2026-09-21T08:00:00' }] }],
    ['stop location', { stops: [{ ...trip.stops[0], location: {} }] }],
    ['stop purposes', { stops: [{ ...trip.stops[0], purposes: ['pickup', 1] }] }],
    ['stop activity IDs', { stops: [{ ...trip.stops[0], activity_ids: null }] }],
    ['route', { route: null }],
    ['geometry array', { route: { ...trip.route, geometry: {} } }],
    ['geometry tuple length', { route: { ...trip.route, geometry: [[1, 2, 3]] } }],
    ['geometry tuple missing coordinate', { route: { ...trip.route, geometry: [[1]] } }],
    ['geometry coordinate type', { route: { ...trip.route, geometry: [['1', 2]] } }],
    ['geometry non-finite coordinate', { route: { ...trip.route, geometry: [[Infinity, 2]] } }],
    [
      'instruction text',
      { route: { ...trip.route, instructions: [{ ...trip.route.instructions[0], text: {} }] } },
    ],
    [
      'instruction time',
      {
        route: {
          ...trip.route,
          instructions: [{ ...trip.route.instructions[0], travel_seconds: undefined }],
        },
      },
    ],
    [
      'instruction distance',
      {
        route: {
          ...trip.route,
          instructions: [{ ...trip.route.instructions[0], distance_meters: NaN }],
        },
      },
    ],
    [
      'instruction point',
      {
        route: {
          ...trip.route,
          instructions: [{ ...trip.route.instructions[0], point: [1, 2, 3] }],
        },
      },
    ],
    ['daily logs array', { days: {} }],
  ])('rejects malformed %s', (_label, change) => {
    expect(isTrip({ ...trip, ...change })).toBe(false);
  });
});

describe('nested daily-log validation', () => {
  it.each([
    ['date', { date: '2026-02-29' }],
    ['date format', { date: '09/21/2026' }],
    ['from label', { from_label: {} }],
    ['to label', { to_label: null }],
    ['distance', { distance_meters: -Infinity }],
    ['segments array', { segments: {} }],
    ['segment ID', { segments: [{ ...day.segments[0], activity_id: 1 }] }],
    ['segment status', { segments: [{ ...day.segments[0], status: 'unknown' }] }],
    ['segment start', { segments: [{ ...day.segments[0], start_second: NaN }] }],
    ['segment end', { segments: [{ ...day.segments[0], end_second: '28800' }] }],
    ['segment purpose', { segments: [{ ...day.segments[0], purpose: null }] }],
    ['segment location', { segments: [{ ...day.segments[0], location: {} }] }],
    ['segment assumption', { segments: [{ ...day.segments[0], assumed: 'true' }] }],
    ['totals record', { totals: [] }],
    ['missing total', { totals: { off_duty: 86400, driving: 0, on_duty: 0 } }],
    ['non-finite total', { totals: { ...day.totals, off_duty: NaN } }],
    ['remarks array', { remarks: {} }],
    ['remark timestamp', { remarks: [{ ...day.remarks[0], time: 'Tbad-date' }] }],
    ['remark time type', { remarks: [{ ...day.remarks[0], time: 800 }] }],
    ['remark status', { remarks: [{ ...day.remarks[0], status: {} }] }],
    ['unknown remark duty status', { remarks: [{ ...day.remarks[0], status: 'sleeping' }] }],
    ['remark purpose', { remarks: [{ ...day.remarks[0], purpose: null }] }],
    ['remark location', { remarks: [{ ...day.remarks[0], location: 1 }] }],
    ['cycle use', { cycle_used_hours: NaN }],
    ['cycle remaining', { cycle_remaining_hours: Infinity }],
  ])('rejects malformed %s', (_label, change) => {
    expect(isTrip({ ...trip, days: [{ ...day, ...change }] })).toBe(false);
  });

  it('accepts projected padding purpose and both display and ISO remark times', () => {
    expect(
      isTrip({
        ...trip,
        days: [
          {
            ...day,
            segments: [{ ...day.segments[0], assumed: true, purpose: 'break' }],
            remarks: [
              { ...day.remarks[0], time: '08:00:01' },
              { ...day.remarks[0], time: '2026-09-21T08:00:01-06:00' },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});
