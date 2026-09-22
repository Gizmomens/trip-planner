import { Icon } from '../../components/Icon';
import { dateTime, duration, hours, miles, TIME_BASIS } from '../../lib/format';
import type { Trip } from '../../types';

export function TripSummary({ trip }: { trip: Trip | null }) {
  const metrics = [
    {
      label: 'Total distance',
      icon: 'route',
      value: trip ? miles(trip.summary.distance_meters) : '—',
      unit: trip ? 'mi' : '',
      detail: 'Including planned detours',
    },
    {
      label: 'Driving time',
      icon: 'truck',
      value: trip ? duration(trip.summary.driving_seconds) : '—',
      unit: '',
      detail: trip
        ? `${hours(trip.summary.cycle_remaining_hours)}h cycle remaining at arrival`
        : 'Road time, not rest time',
    },
    {
      label: 'Trip duration',
      icon: 'clock',
      value: trip ? duration(trip.summary.elapsed_seconds) : '—',
      unit: '',
      detail: trip
        ? `${trip.summary.days} calendar ${trip.summary.days === 1 ? 'day' : 'days'} · work + rest included`
        : 'With work, breaks & rest',
    },
    {
      label: 'Projected arrival',
      icon: 'calendar',
      value: trip ? dateTime(trip.arrival_at) : '—',
      unit: '',
      detail: `All times fixed ${TIME_BASIS}`,
    },
  ] as const;
  return (
    <section className="summary-grid" aria-label="Trip summary">
      {metrics.map((metric) => (
        <div className="metric-card" key={metric.label}>
          <div className="metric-label">
            <span>{metric.label}</span>
            <Icon name={metric.icon} size={19} />
          </div>
          <div className="metric-value">
            {metric.value}
            <span>{metric.unit}</span>
          </div>
          <p>{metric.detail}</p>
        </div>
      ))}
    </section>
  );
}
