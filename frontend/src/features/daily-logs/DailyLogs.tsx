import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { dateLabel, hours, miles, TIME_BASIS } from '../../lib/format';
import type { Trip } from '../../types';
import { DutySegmentsTable } from './DutySegmentsTable';
import { LogGrid } from './LogGrid';

export function DailyLogs({ trip }: { trip: Trip | null }) {
  const [index, setIndex] = useState(0);
  const days = trip?.days ?? [];
  const day = days[Math.min(index, days.length - 1)];
  const unknowns = [
    'Driver',
    'Co-driver',
    'Carrier',
    'Truck / tractor',
    'Trailer',
    'Shipping documents',
    'Main office address',
    'Home terminal address',
  ];

  return (
    <section className="daily-logs-section" id="daily-logs" aria-labelledby="logs-heading">
      <div className="logs-section-heading">
        <div>
          <span className="section-eyebrow">THE DETAILS, TAKEN CARE OF</span>
          <h2 id="logs-heading">
            <Icon name="log" size={25} />
            Your daily logbook
          </h2>
          <p>Every duty change. Every calendar day. One clear picture.</p>
        </div>
        <span className="projected-badge">PROJECTED · NOT CERTIFIED</span>
      </div>
      {!day ? (
        <div className="logs-empty panel">
          <div className="empty-log-symbol">
            <Icon name="log" size={44} />
          </div>
          <div>
            <h3>Your trip will tell the story.</h3>
            <p>
              Generate a plan to see complete 24-hour duty graphs, daily mileage, and stop remarks.
              <br />
              These are planning projections, never signed or certified driving records.
            </p>
          </div>
          <span className="subtle-badge">70 hours / 8 days</span>
        </div>
      ) : (
        <>
          <nav className="day-navigation" aria-label="Daily log navigation">
            <button
              className="icon-button"
              type="button"
              aria-label="Previous day"
              disabled={index === 0}
              onClick={() => setIndex((value) => value - 1)}
            >
              <Icon name="chevron" style={{ transform: 'rotate(180deg)' }} />
            </button>
            <div className="day-buttons">
              {days.map((item, dayIndex) => (
                <button
                  key={item.date}
                  type="button"
                  aria-current={index === dayIndex ? 'date' : undefined}
                  className={index === dayIndex ? 'active' : ''}
                  onClick={() => setIndex(dayIndex)}
                >
                  <span>DAY {String(dayIndex + 1).padStart(2, '0')}</span>
                  {dateLabel(item.date).split(',').slice(0, 2).join(',')}
                </button>
              ))}
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Next day"
              disabled={index >= days.length - 1}
              onClick={() => setIndex((value) => value + 1)}
            >
              <Icon name="chevron" />
            </button>
          </nav>
          <article className="log-sheet" aria-label={`Projected daily log for ${day.date}`}>
            <div className="log-sheet-heading">
              <div>
                <span className="sheet-kicker">SPOTTER / PROJECTED ASSESSMENT PLAN</span>
                <h3>Driver’s daily log</h3>
                <p>24-hour record · fixed {TIME_BASIS} · 70-hour / 8-day model</p>
              </div>
              <div className="sheet-date">
                <strong>{dateLabel(day.date)}</strong>
                <span>
                  Day {index + 1} of {days.length}
                </span>
                <span className="projected-stamp">PROJECTED / NOT CERTIFIED</span>
              </div>
            </div>
            <div className="log-route">
              <div>
                <span>FROM</span>
                <strong>{day.from_label}</strong>
              </div>
              <Icon name="arrow" size={20} />
              <div>
                <span>TO</span>
                <strong>{day.to_label}</strong>
              </div>
              <div className="log-mileage">
                <span>ESTIMATED MILES TODAY</span>
                <strong>
                  {miles(day.distance_meters)} <small>mi</small>
                </strong>
              </div>
            </div>
            <div className="identity-grid">
              {unknowns.map((label) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>Not provided</strong>
                </div>
              ))}
            </div>
            <LogGrid day={day} />
            <div className="log-grid-note">
              <Icon name="info" size={16} />
              <p>
                Day-boundary off-duty time is explicitly assumed. Mileage is a route estimate;
                cross-midnight allocation may be interpolated. Neither is vehicle telemetry.
              </p>
            </div>
            <section className="cycle-recap">
              <h4>Projected cycle recap</h4>
              <dl>
                <div>
                  <dt>Model cycle used</dt>
                  <dd>{hours(day.cycle_used_hours)} h</dd>
                </div>
                <div>
                  <dt>Remaining cycle budget</dt>
                  <dd>{hours(day.cycle_remaining_hours)} h</dd>
                </div>
                <div>
                  <dt>Historical daily recap</dt>
                  <dd>Not available</dd>
                </div>
                <div>
                  <dt>Next-day recapture</dt>
                  <dd>Not available</dd>
                </div>
                <div>
                  <dt>60-hour / 7-day recap</dt>
                  <dd>Not applicable</dd>
                </div>
              </dl>
              <p>
                Aggregate usage is modeled conservatively. Previous daily records were not provided.
              </p>
            </section>
            <DutySegmentsTable day={day} />
            <div className="signature-row">
              <span>
                Driver signature <strong>Not provided</strong>
              </span>
              <p>
                No certification has been made. This is a projected plan, not an actual ELD record.
              </p>
            </div>
          </article>
        </>
      )}
    </section>
  );
}
