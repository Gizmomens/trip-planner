export const ASSUMPTION_COPY = {
  A08: {
    title: 'Fixed planning clock',
    detail:
      '08:00 departure on the displayed date; all logs use fixed UTC-06:00, not the browser timezone.',
  },
  A09: {
    title: 'Fresh driving shift',
    detail: 'At least 10 hours off before departure. Current cycle usage still applies.',
  },
  A12: {
    title: 'Conservative 70-hour cycle',
    detail:
      'No historical daily recapture is inferred. A 34-hour restart restores cycle capacity when needed.',
  },
  A11: {
    title: 'Full sleeper-berth rests',
    detail:
      'Full 10-hour daily rests and 34-hour restarts use the sleeper-berth row. Ordinary 30-minute breaks remain off duty; no split-sleeper optimization.',
  },
  A20: {
    title: 'Real facilities, assumed availability',
    detail:
      'Mapped fuel/rest facilities are assumed usable at any time, for any required stay. Parking and opening hours are not checked.',
  },
  A21: {
    title: 'Fuel and loading',
    detail:
      'Start fully fueled. Fuel every 1,000 routed miles or earlier: 30 minutes on duty. Pickup and drop-off: one hour each.',
  },
  A17: {
    title: 'Estimated truck route',
    detail:
      'Generic truck routing without vehicle dimensions or live traffic replanning. Not guaranteed vehicle-specific navigation.',
  },
  A26: {
    title: 'Projected sheets only',
    detail:
      'Outside-trip time is assumed off duty. Missing identity and shipping fields are not provided. These are not certified ELD records.',
  },
} as const;

export type AssumptionId = keyof typeof ASSUMPTION_COPY;

export function isAssumptionId(value: unknown): value is AssumptionId {
  return typeof value === 'string' && Object.hasOwn(ASSUMPTION_COPY, value);
}

export function assumptionsFor(ids: AssumptionId[]) {
  return ids.map((id) => ({ id, ...ASSUMPTION_COPY[id] }));
}
