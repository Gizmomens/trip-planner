import type { DutyStatus } from '../types';

export const TIME_BASIS = 'UTC−06:00';
export const DUTY_ORDER: DutyStatus[] = ['off_duty', 'sleeper', 'driving', 'on_duty'];
export const DUTY_LABELS: Record<DutyStatus, string> = {
  off_duty: 'Off duty',
  sleeper: 'Sleeper berth',
  driving: 'Driving',
  on_duty: 'On duty (not driving)',
};

const zone = { timeZone: 'Etc/GMT+6' };
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  ...zone,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const fullFormatter = new Intl.DateTimeFormat('en-US', {
  ...zone,
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  ...zone,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export const time = (iso: string) => timeFormatter.format(new Date(iso));
export const dateTime = (iso: string) => fullFormatter.format(new Date(iso));
export const dateLabel = (iso: string) =>
  dateFormatter.format(new Date(iso.length === 10 ? `${iso}T12:00:00-06:00` : iso));
export const miles = (meters: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(meters / 1609.344);
export const hours = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

export function duration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h ? `${h}h ` : ''}${m}m${s ? ` ${s}s` : ''}`;
}

export function logTime(second: number) {
  const h = Math.floor(second / 3600);
  const m = Math.floor((second % 3600) / 60);
  const s = second % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${s ? `:${String(s).padStart(2, '0')}` : ''}`;
}

export function purposeLabel(purpose: string) {
  const names: Record<string, string> = {
    driving: 'Driving',
    pickup: 'Pickup',
    dropoff: 'Drop-off',
    fuel: 'Fuel stop',
    break: '30-minute break',
    daily_rest: 'Daily rest',
    cycle_restart: '34-hour restart',
    assumed_off_duty: 'Assumed off duty',
  };
  return names[purpose] ?? purpose.replaceAll('_', ' ');
}
