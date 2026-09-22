import type { Bootstrap, DailyLog, Location, Trip } from '../src/types';

export const locations: Location[] = [
  {
    id: 'chicago',
    name: 'Chicago',
    address: 'Chicago, IL, US',
    lat: 41.88,
    lon: -87.63,
    kind: 'address',
    token: 'signed-current',
  },
  {
    id: 'gary',
    name: 'Gary warehouse',
    address: 'Gary, IN, US',
    lat: 41.59,
    lon: -87.34,
    kind: 'address',
    token: 'signed-pickup',
  },
  {
    id: 'toledo',
    name: 'Toledo delivery',
    address: 'Toledo, OH, US',
    lat: 41.65,
    lon: -83.54,
    kind: 'address',
    token: 'signed-dropoff',
  },
];

export const bootstrap: Bootstrap = {
  csrf_token: 'csrf-test-token',
  planning_token: 'signed-planning-context',
  departure_at: '2026-09-21T08:00:00-06:00',
  time_basis: 'UTC-06:00',
  map_key: '',
  provider_ready: true,
  assumptions: [
    {
      id: 'fresh-shift',
      title: 'Fresh initial shift',
      detail: 'At least 10 hours off duty before departure.',
    },
  ],
  limits: { days: 30, facilities: 100, provider_requests: 100, processing_seconds: 120 },
};

export const day: DailyLog = {
  date: '2026-09-21',
  from_label: 'Chicago, IL',
  to_label: 'Toledo, OH',
  distance_meters: 418429.44,
  segments: [
    {
      activity_id: 'before',
      status: 'off_duty',
      start_second: 0,
      end_second: 28800,
      purpose: 'assumed_off_duty',
      location: 'Chicago, IL',
      assumed: true,
    },
    {
      activity_id: 'drive-a',
      status: 'driving',
      start_second: 28800,
      end_second: 32400,
      purpose: 'driving',
      location: 'Chicago → Gary',
      assumed: false,
    },
    {
      activity_id: 'pickup',
      status: 'on_duty',
      start_second: 32400,
      end_second: 36000,
      purpose: 'pickup',
      location: 'Gary, IN',
      assumed: false,
    },
    {
      activity_id: 'drive-b',
      status: 'driving',
      start_second: 36000,
      end_second: 43200,
      purpose: 'driving',
      location: 'Gary → Toledo',
      assumed: false,
    },
    {
      activity_id: 'dropoff',
      status: 'on_duty',
      start_second: 43200,
      end_second: 46800,
      purpose: 'dropoff',
      location: 'Toledo, OH',
      assumed: false,
    },
    {
      activity_id: 'after',
      status: 'off_duty',
      start_second: 46800,
      end_second: 86400,
      purpose: 'assumed_off_duty',
      location: 'Toledo, OH',
      assumed: true,
    },
  ],
  totals: { off_duty: 68400, sleeper: 0, driving: 10800, on_duty: 7200 },
  remarks: [
    { time: '09:00', location: 'Gary, IN', purpose: 'pickup', status: 'on_duty' },
    { time: '12:00', location: 'Toledo, OH', purpose: 'dropoff', status: 'on_duty' },
  ],
  cycle_used_hours: 15,
  cycle_remaining_hours: 55,
};

export const trip: Trip = {
  id: 'authored-test-trip',
  departure_at: bootstrap.departure_at,
  arrival_at: '2026-09-21T13:00:00-06:00',
  time_basis: 'UTC-06:00',
  locations,
  activities: [
    {
      id: 'drive-a',
      status: 'driving',
      purpose: 'driving',
      start_at: '2026-09-21T08:00:00-06:00',
      end_at: '2026-09-21T09:00:00-06:00',
      start_location: locations[0]!,
      end_location: locations[1]!,
      distance_meters: 96560.64,
    },
    {
      id: 'pickup',
      status: 'on_duty',
      purpose: 'pickup',
      start_at: '2026-09-21T09:00:00-06:00',
      end_at: '2026-09-21T10:00:00-06:00',
      start_location: locations[1]!,
      end_location: locations[1]!,
      distance_meters: 0,
    },
    {
      id: 'drive-b',
      status: 'driving',
      purpose: 'driving',
      start_at: '2026-09-21T10:00:00-06:00',
      end_at: '2026-09-21T12:00:00-06:00',
      start_location: locations[1]!,
      end_location: locations[2]!,
      distance_meters: 321868.8,
    },
    {
      id: 'dropoff',
      status: 'on_duty',
      purpose: 'dropoff',
      start_at: '2026-09-21T12:00:00-06:00',
      end_at: '2026-09-21T13:00:00-06:00',
      start_location: locations[2]!,
      end_location: locations[2]!,
      distance_meters: 0,
    },
  ],
  stops: [
    {
      id: 'stop-pickup',
      location: locations[1]!,
      arrival_at: '2026-09-21T09:00:00-06:00',
      departure_at: '2026-09-21T10:00:00-06:00',
      purposes: ['pickup'],
      activity_ids: ['pickup'],
    },
    {
      id: 'stop-dropoff',
      location: locations[2]!,
      arrival_at: '2026-09-21T12:00:00-06:00',
      departure_at: '2026-09-21T13:00:00-06:00',
      purposes: ['dropoff'],
      activity_ids: ['dropoff'],
    },
  ],
  route: {
    geometry: [
      [-87.63, 41.88],
      [-87.34, 41.59],
      [-83.54, 41.65],
    ],
    instructions: [
      {
        text: 'Follow I-90 east toward Gary.',
        distance_meters: 96560.64,
        travel_seconds: 3600,
        point: [-87.63, 41.88],
      },
      {
        text: 'Continue east toward Toledo.',
        distance_meters: 321868.8,
        travel_seconds: 7200,
        point: [-87.34, 41.59],
      },
    ],
  },
  summary: {
    distance_meters: 418429.44,
    driving_seconds: 10800,
    on_duty_seconds: 7200,
    off_duty_seconds: 0,
    elapsed_seconds: 18000,
    days: 1,
    cycle_remaining_hours: 55,
  },
  days: [day],
  assumptions: bootstrap.assumptions,
  warnings: ['Facility access is assumed, not verified.'],
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
