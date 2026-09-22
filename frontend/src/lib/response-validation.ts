import type {
  Activity,
  Assumption,
  Bootstrap,
  DailyLog,
  DutyStatus,
  Location,
  Stop,
  Trip,
} from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonemptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isArrayOf<T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every((item: unknown) => isItem(item));
}

function isCalendarDate(value: unknown): value is string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return (
    isString(value) &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) &&
    isCalendarDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}

function isDutyStatus(value: unknown): value is DutyStatus {
  return value === 'off_duty' || value === 'sleeper' || value === 'driving' || value === 'on_duty';
}

function isPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  );
}

function isLocation(value: unknown): value is Location {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.address) &&
    isFiniteNumber(value.lat) &&
    isFiniteNumber(value.lon) &&
    isString(value.kind) &&
    (value.token === undefined || isString(value.token))
  );
}

function isSelectableLocation(value: unknown): value is Location & { token: string } {
  return isLocation(value) && isNonemptyString(value.token);
}

function isAssumption(value: unknown): value is Assumption {
  return isRecord(value) && isString(value.id) && isString(value.title) && isString(value.detail);
}

export function isBootstrap(value: unknown): value is Bootstrap {
  return (
    isRecord(value) &&
    isNonemptyString(value.csrf_token) &&
    isNonemptyString(value.planning_token) &&
    isTimestamp(value.departure_at) &&
    isString(value.time_basis) &&
    isString(value.map_key) &&
    typeof value.provider_ready === 'boolean' &&
    isArrayOf(value.assumptions, isAssumption) &&
    isRecord(value.limits) &&
    isFiniteNumber(value.limits.days) &&
    isFiniteNumber(value.limits.facilities) &&
    isFiniteNumber(value.limits.provider_requests) &&
    isFiniteNumber(value.limits.processing_seconds)
  );
}

export function isLocationsResponse(value: unknown): value is { locations: Location[] } {
  return isRecord(value) && isArrayOf(value.locations, isSelectableLocation);
}

function isActivity(value: unknown): value is Activity {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isDutyStatus(value.status) &&
    isString(value.purpose) &&
    isTimestamp(value.start_at) &&
    isTimestamp(value.end_at) &&
    isLocation(value.start_location) &&
    isLocation(value.end_location) &&
    isFiniteNumber(value.distance_meters)
  );
}

function isStop(value: unknown): value is Stop {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isLocation(value.location) &&
    isTimestamp(value.arrival_at) &&
    isTimestamp(value.departure_at) &&
    isArrayOf(value.purposes, isString) &&
    isArrayOf(value.activity_ids, isString)
  );
}

function isInstruction(value: unknown): value is Trip['route']['instructions'][number] {
  return (
    isRecord(value) &&
    isString(value.text) &&
    isFiniteNumber(value.distance_meters) &&
    isFiniteNumber(value.travel_seconds) &&
    isPoint(value.point)
  );
}

function isRoute(value: unknown): value is Trip['route'] {
  return (
    isRecord(value) &&
    isArrayOf(value.geometry, isPoint) &&
    isArrayOf(value.instructions, isInstruction)
  );
}

function isSummary(value: unknown): value is Trip['summary'] {
  return (
    isRecord(value) &&
    isFiniteNumber(value.distance_meters) &&
    isFiniteNumber(value.driving_seconds) &&
    isFiniteNumber(value.on_duty_seconds) &&
    isFiniteNumber(value.off_duty_seconds) &&
    isFiniteNumber(value.elapsed_seconds) &&
    isFiniteNumber(value.days) &&
    isFiniteNumber(value.cycle_remaining_hours)
  );
}

function isSegment(value: unknown): value is DailyLog['segments'][number] {
  return (
    isRecord(value) &&
    isString(value.activity_id) &&
    isDutyStatus(value.status) &&
    isFiniteNumber(value.start_second) &&
    isFiniteNumber(value.end_second) &&
    isString(value.purpose) &&
    isString(value.location) &&
    typeof value.assumed === 'boolean'
  );
}

function isRemark(value: unknown): value is DailyLog['remarks'][number] {
  return (
    isRecord(value) &&
    isString(value.time) &&
    (!value.time.includes('T') || isTimestamp(value.time)) &&
    isString(value.location) &&
    isString(value.purpose) &&
    isDutyStatus(value.status)
  );
}

function isDailyLog(value: unknown): value is DailyLog {
  return (
    isRecord(value) &&
    isCalendarDate(value.date) &&
    isString(value.from_label) &&
    isString(value.to_label) &&
    isFiniteNumber(value.distance_meters) &&
    isArrayOf(value.segments, isSegment) &&
    isRecord(value.totals) &&
    isFiniteNumber(value.totals.off_duty) &&
    isFiniteNumber(value.totals.sleeper) &&
    isFiniteNumber(value.totals.driving) &&
    isFiniteNumber(value.totals.on_duty) &&
    isArrayOf(value.remarks, isRemark) &&
    isFiniteNumber(value.cycle_used_hours) &&
    isFiniteNumber(value.cycle_remaining_hours)
  );
}

export function isTrip(value: unknown): value is Trip {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isTimestamp(value.departure_at) &&
    isTimestamp(value.arrival_at) &&
    isString(value.time_basis) &&
    isArrayOf(value.locations, isLocation) &&
    isArrayOf(value.activities, isActivity) &&
    isArrayOf(value.stops, isStop) &&
    isRoute(value.route) &&
    isSummary(value.summary) &&
    isArrayOf(value.days, isDailyLog) &&
    isArrayOf(value.assumptions, isAssumption) &&
    isArrayOf(value.warnings, isString)
  );
}
