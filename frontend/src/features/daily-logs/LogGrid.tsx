import { useId } from 'react';
import { duration, DUTY_LABELS, DUTY_ORDER, purposeLabel, time } from '../../lib/format';
import type { DailyLog } from '../../types';

const LEFT = 180;
const TOP = 66;
const WIDTH = 780;
const ROW_HEIGHT = 44;
const GRID_BOTTOM = TOP + ROW_HEIGHT * 4;
const REMARKS_TOP = 282;

function clockParts(value: string): [number, number, number] {
  if (value.includes('T')) {
    const instant = new Date(value);
    const fixed = new Date(instant.getTime() - 6 * 3600 * 1000);
    return [fixed.getUTCHours(), fixed.getUTCMinutes(), fixed.getUTCSeconds()];
  }
  const match = /(?:^|T)(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : [0, 0, 0];
}

function clockSecond(value: string) {
  const [hour, minute, second] = clockParts(value);
  return hour * 3600 + minute * 60 + second;
}

function clockLabel(value: string) {
  return value.includes('T') ? time(value) : value.slice(0, 5);
}

function decimalHours(seconds: number) {
  const value = seconds / 3600;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function shortRemark(purpose: string, location: string) {
  const value = `${purposeLabel(purpose)} — ${location}`;
  return value.length > 58 ? `${value.slice(0, 55)}…` : value;
}

export function LogGrid({ day }: { day: DailyLog }) {
  const id = useId();
  const x = (seconds: number) => LEFT + (seconds / 86400) * WIDTH;
  const y = (status: DailyLog['segments'][number]['status']) =>
    TOP + (DUTY_ORDER.indexOf(status) + 0.5) * ROW_HEIGHT;
  const total = DUTY_ORDER.reduce((sum, status) => sum + day.totals[status], 0);
  const remarkRows = Math.max(1, Math.ceil(day.remarks.length / 2));
  const viewHeight = REMARKS_TOP + 102 + remarkRows * 30;

  return (
    <div className="log-grid-scroll" tabIndex={0} aria-label="Scrollable completed daily log">
      <svg
        className="log-grid"
        viewBox={`0 0 1180 ${viewHeight}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>Projected completed daily log for {day.date}</title>
        <desc id={`${id}-description`}>
          Four duty rows and connected remarks across 24 hours in fixed UTC-06:00. Dashed lines are
          assumed off-duty time. Exact times are available in the segment table below. Total:{' '}
          {duration(total)}.
        </desc>

        <text x={LEFT + WIDTH / 2} y={19} textAnchor="middle" className="grid-paper-title">
          DRIVER&apos;S DAILY LOG
        </text>
        <text x={LEFT + WIDTH / 2} y={35} textAnchor="middle" className="grid-paper-subtitle">
          ONE CALENDAR DAY — 24 HOURS
        </text>
        <text x={1042} y={50} textAnchor="middle" className="grid-small-label">
          TOTAL
        </text>
        <text x={1042} y={61} textAnchor="middle" className="grid-small-label">
          HOURS
        </text>

        <rect
          x={LEFT}
          y={TOP}
          width={WIDTH}
          height={ROW_HEIGHT * 4}
          fill="#fff"
          stroke="#263845"
          strokeWidth={1.4}
        />

        {DUTY_ORDER.map((status, index) => (
          <g key={status}>
            <text
              x={156}
              y={y(status) - (status === 'on_duty' ? 6 : 0)}
              textAnchor="end"
              className="grid-row-label"
            >
              {status === 'on_duty' ? 'On Duty' : DUTY_LABELS[status]}
            </text>
            {status === 'on_duty' && (
              <text x={156} y={y(status) + 8} textAnchor="end" className="grid-small-label">
                (Not Driving)
              </text>
            )}
            <text x={1042} y={y(status) + 5} textAnchor="middle" className="grid-paper-total">
              {decimalHours(day.totals[status])}
            </text>
            <line
              x1={1022}
              x2={1080}
              y1={TOP + (index + 1) * ROW_HEIGHT}
              y2={TOP + (index + 1) * ROW_HEIGHT}
              stroke="#263845"
            />
          </g>
        ))}

        {Array.from({ length: 25 }, (_, hour) => (
          <g key={hour}>
            <line
              x1={x(hour * 3600)}
              x2={x(hour * 3600)}
              y1={TOP}
              y2={GRID_BOTTOM}
              stroke="#263845"
              strokeWidth={hour === 0 || hour === 24 ? 1.4 : 0.9}
            />
            <text x={x(hour * 3600)} y={57} textAnchor="middle" className="grid-hour">
              {hour === 0 ? 'Midnight' : hour === 12 ? 'Noon' : hour === 24 ? '' : hour}
            </text>
          </g>
        ))}

        {Array.from({ length: 96 }, (_, index) => index + 1)
          .filter((quarter) => quarter % 4 !== 0)
          .flatMap((quarter) =>
            DUTY_ORDER.map((status, row) => {
              const halfHour = quarter % 2 === 0;
              return (
                <line
                  key={`${quarter}-${status}`}
                  x1={x(quarter * 900)}
                  x2={x(quarter * 900)}
                  y1={TOP + row * ROW_HEIGHT}
                  y2={TOP + row * ROW_HEIGHT + (halfHour ? 20 : 12)}
                  stroke="#263845"
                  strokeWidth={0.75}
                />
              );
            }),
          )}

        {Array.from({ length: 5 }, (_, index) => (
          <line
            key={index}
            x1={LEFT}
            x2={LEFT + WIDTH}
            y1={TOP + index * ROW_HEIGHT}
            y2={TOP + index * ROW_HEIGHT}
            stroke="#263845"
            strokeWidth={1.1}
          />
        ))}

        {day.segments.map((segment, index) => {
          const previous = day.segments[index - 1];
          return (
            <g key={`${segment.activity_id}-${index}`}>
              {previous &&
                previous.end_second === segment.start_second &&
                previous.status !== segment.status && (
                  <line
                    data-testid="duty-transition"
                    x1={x(segment.start_second)}
                    x2={x(segment.start_second)}
                    y1={y(previous.status)}
                    y2={y(segment.status)}
                    className="grid-duty-line"
                  />
                )}
              <line
                data-testid="duty-segment"
                data-status={segment.status}
                data-assumed={segment.assumed}
                x1={x(segment.start_second)}
                x2={x(segment.end_second)}
                y1={y(segment.status)}
                y2={y(segment.status)}
                className={segment.assumed ? 'grid-duty-line assumed' : 'grid-duty-line'}
              />
            </g>
          );
        })}

        <g data-testid="remarks-band">
          <text x={156} y={REMARKS_TOP + 7} textAnchor="end" className="grid-remarks-heading">
            REMARKS
          </text>
          <line
            x1={LEFT}
            x2={LEFT + WIDTH}
            y1={REMARKS_TOP}
            y2={REMARKS_TOP}
            stroke="#263845"
            strokeWidth={1.2}
          />
          {Array.from({ length: 97 }, (_, quarter) => (
            <line
              key={quarter}
              x1={x(quarter * 900)}
              x2={x(quarter * 900)}
              y1={REMARKS_TOP}
              y2={REMARKS_TOP + (quarter % 4 === 0 ? 28 : quarter % 2 === 0 ? 20 : 12)}
              stroke="#263845"
              strokeWidth={quarter % 4 === 0 ? 0.9 : 0.7}
            />
          ))}
          {day.remarks.map((remark, index) => {
            const second = clockSecond(remark.time);
            const remarkX = x(second);
            const column = index % 2;
            const row = Math.floor(index / 2);
            const labelX = LEFT + column * (WIDTH / 2);
            const labelY = REMARKS_TOP + 64 + row * 30;
            const label = shortRemark(remark.purpose, remark.location);
            return (
              <g key={`${remark.time}-${remark.purpose}-${index}`} data-testid="log-remark">
                <title>{`${clockLabel(remark.time)} · ${purposeLabel(remark.purpose)} · ${remark.location}`}</title>
                <line
                  x1={remarkX}
                  x2={remarkX}
                  y1={GRID_BOTTOM}
                  y2={REMARKS_TOP}
                  className="grid-remark-connector"
                />
                <circle cx={remarkX} cy={REMARKS_TOP} r={3} className="grid-remark-marker" />
                <text x={labelX} y={labelY} className="grid-remark-index">
                  {index + 1}.
                </text>
                <text x={labelX + 17} y={labelY} className="grid-remark-time">
                  {clockLabel(remark.time)}
                </text>
                <text x={labelX + 66} y={labelY} className="grid-remark-label">
                  {label}
                </text>
              </g>
            );
          })}
          {day.remarks.length === 0 && (
            <text x={LEFT + 12} y={REMARKS_TOP + 48} className="grid-small-label">
              No projected duty-change remarks for this day.
            </text>
          )}
          <text x={1042} y={REMARKS_TOP + 36} textAnchor="middle" className="grid-paper-total">
            = {decimalHours(total)}
          </text>
          <line x1={1018} x2={1084} y1={REMARKS_TOP + 44} y2={REMARKS_TOP + 44} stroke="#263845" />
        </g>

        <text x={LEFT} y={viewHeight - 14} className="grid-small-label">
          SOLID: PROJECTED ACTIVITY · DASHED: ASSUMED DAY-BOUNDARY OFF DUTY
        </text>
        <text
          x={1042}
          y={viewHeight - 14}
          textAnchor="middle"
          className="grid-paper-total"
          data-testid="log-total"
        >
          {duration(total)}
        </text>
      </svg>
      {total !== 86400 && (
        <p className="field-error" role="alert">
          The supplied daily totals do not equal 24 hours. This sheet is incomplete; regenerate the
          plan.
        </p>
      )}
    </div>
  );
}
