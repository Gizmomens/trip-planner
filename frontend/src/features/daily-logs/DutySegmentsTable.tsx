import { duration, DUTY_LABELS, logTime, purposeLabel, TIME_BASIS } from '../../lib/format';
import type { DailyLog } from '../../types';

export function DutySegmentsTable({ day }: { day: DailyLog }) {
  return (
    <details className="segment-details" open>
      <summary>
        Exact duty segments <span>Accessible text view · fixed {TIME_BASIS}</span>
      </summary>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Exact duty segments for {day.date}</caption>
          <thead>
            <tr>
              <th>Start</th>
              <th>End</th>
              <th>Duration</th>
              <th>Duty status</th>
              <th>Purpose / location</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {day.segments.map((segment, index) => (
              <tr key={`${segment.activity_id}-${index}`}>
                <td>{logTime(segment.start_second)}</td>
                <td>{logTime(segment.end_second)}</td>
                <td>{duration(segment.end_second - segment.start_second)}</td>
                <td>
                  <span className={`duty-tag duty-${segment.status}`}>
                    {DUTY_LABELS[segment.status]}
                  </span>
                </td>
                <td>
                  {segment.assumed ? 'Assumed off duty' : purposeLabel(segment.purpose)}
                  <small>{segment.location}</small>
                </td>
                <td>{segment.assumed ? 'Assumed off duty' : 'Projected'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
