import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { dateTime, duration, DUTY_LABELS, miles, purposeLabel, TIME_BASIS } from '../../lib/format';
import type { Trip } from '../../types';

interface Props {
  trip: Trip | null;
  selectedStop: string | null;
  onSelectStop: (id: string) => void;
}

export function Itinerary({ trip, selectedStop, onSelectStop }: Props) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const button = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('button[data-stop-id]') ?? [],
    ).find((item) => item.dataset.stopId === selectedStop);
    if (button && list.current) {
      const top = button.offsetTop - list.current.offsetTop;
      if (
        top < list.current.scrollTop ||
        top + button.offsetHeight > list.current.scrollTop + list.current.clientHeight
      )
        list.current.scrollTop = Math.max(0, top - 8);
    }
  }, [selectedStop]);

  return (
    <section className="itinerary-panel panel" aria-labelledby="itinerary-heading">
      <div className="panel-header">
        <div>
          <span className="section-eyebrow">ONE STOP AT A TIME</span>
          <h2 id="itinerary-heading">Your itinerary</h2>
        </div>
        <span className="count-badge">{trip ? `${trip.stops.length} stops` : 'Not planned'}</span>
      </div>
      {!trip ? (
        <div className="compact-empty">
          <div className="empty-icon">
            <Icon name="clock" size={26} />
          </div>
          <h3>All the right stops.</h3>
          <p>
            Pickup, fuel, breaks, rest, and delivery —<br />
            in the order your trip needs them.
          </p>
        </div>
      ) : (
        <>
          <p className="itinerary-time-basis">
            Departure {dateTime(trip.departure_at)} · {TIME_BASIS}
          </p>
          <ol className="stop-list" ref={list}>
            {trip.stops.map((stop, index) => {
              const activities = trip.activities.filter((activity) =>
                stop.activity_ids.includes(activity.id),
              );
              return (
                <li key={stop.id} className={selectedStop === stop.id ? 'selected' : ''}>
                  <button
                    type="button"
                    data-stop-id={stop.id}
                    aria-pressed={selectedStop === stop.id}
                    onClick={() => onSelectStop(stop.id)}
                  >
                    <span className="timeline-number">{index + 1}</span>
                    <span className="stop-content">
                      <span className="stop-purpose">
                        {stop.purposes.map(purposeLabel).join(' + ')}
                      </span>
                      <strong>{stop.location.name}</strong>
                      <span className="stop-address">
                        {stop.location.address || 'Address not supplied'}
                      </span>
                      <span className="stop-time">
                        {dateTime(stop.arrival_at)} → {dateTime(stop.departure_at)}
                      </span>
                      <span className="stop-duties">
                        {activities.map((activity) => (
                          <span className={`duty-tag duty-${activity.status}`} key={activity.id}>
                            {DUTY_LABELS[activity.status]} ·{' '}
                            {duration(
                              (Date.parse(activity.end_at) - Date.parse(activity.start_at)) / 1000,
                            )}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {trip && (
        <details className="activity-details">
          <summary>Complete duty timeline · {trip.activities.length} activities</summary>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                Every projected duty activity in fixed UTC-06:00
              </caption>
              <thead>
                <tr>
                  <th>Start / end</th>
                  <th>Status & purpose</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {trip.activities.map((activity) => (
                  <tr key={activity.id}>
                    <td>
                      {dateTime(activity.start_at)}
                      <br />
                      {dateTime(activity.end_at)}
                    </td>
                    <td>
                      {DUTY_LABELS[activity.status]}
                      <br />
                      {purposeLabel(activity.purpose)}
                    </td>
                    <td>
                      {activity.start_location.name}
                      {activity.start_location.id !== activity.end_location.id && (
                        <> → {activity.end_location.name}</>
                      )}
                      {activity.distance_meters > 0 && (
                        <small>{miles(activity.distance_meters)} mi</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
