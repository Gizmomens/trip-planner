export type DutyStatus = 'off_duty' | 'sleeper' | 'driving' | 'on_duty';
export type LocationField = 'current' | 'pickup' | 'dropoff';

export interface Location {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  kind: string;
  token?: string;
}

export interface Assumption {
  id: string;
  title: string;
  detail: string;
}

export interface Bootstrap {
  csrf_token: string;
  planning_token: string;
  departure_at: string;
  time_basis: string;
  map_key: string;
  provider_ready: boolean;
  assumptions: Assumption[];
  limits: {
    days: number;
    facilities: number;
    provider_requests: number;
    processing_seconds: number;
  };
}

export interface Activity {
  id: string;
  status: DutyStatus;
  purpose: string;
  start_at: string;
  end_at: string;
  start_location: Location;
  end_location: Location;
  distance_meters: number;
}

export interface Stop {
  id: string;
  location: Location;
  arrival_at: string;
  departure_at: string;
  purposes: string[];
  activity_ids: string[];
}

export interface DailyLog {
  date: string;
  from_label: string;
  to_label: string;
  distance_meters: number;
  segments: {
    activity_id: string;
    status: DutyStatus;
    start_second: number;
    end_second: number;
    purpose: string;
    location: string;
    assumed: boolean;
  }[];
  totals: Record<DutyStatus, number>;
  remarks: { time: string; location: string; purpose: string; status: string }[];
  cycle_used_hours: number;
  cycle_remaining_hours: number;
}

export interface Trip {
  id: string;
  departure_at: string;
  arrival_at: string;
  time_basis: string;
  locations: Location[];
  activities: Activity[];
  stops: Stop[];
  route: {
    geometry: [number, number][];
    instructions: {
      text: string;
      distance_meters: number;
      travel_seconds: number;
      point: [number, number];
    }[];
  };
  summary: {
    distance_meters: number;
    driving_seconds: number;
    on_duty_seconds: number;
    off_duty_seconds: number;
    elapsed_seconds: number;
    days: number;
    cycle_remaining_hours: number;
  };
  days: DailyLog[];
  assumptions: Assumption[];
  warnings: string[];
}

export interface TripInput {
  current: string;
  pickup: string;
  dropoff: string;
  cycle_used_hours: number;
  planning_token: string;
}

export interface ErrorDetail {
  code: string;
  message: string;
  fields: Record<string, string>;
  request_id: string;
}
