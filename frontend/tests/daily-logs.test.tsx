import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DailyLogs } from '../src/features/daily-logs/DailyLogs';
import { LogGrid } from '../src/features/daily-logs/LogGrid';
import { day, trip } from './fixtures';

describe('daily projected log sheets', () => {
  it('draws exact segment positions, quarter-hour guides, transitions, all four rows, and exact 24-hour totals', () => {
    const preciseDay = structuredClone(day);
    preciseDay.segments[0]!.end_second++;
    preciseDay.segments[1]!.start_second++;
    preciseDay.totals.off_duty++;
    preciseDay.totals.driving--;
    const { container } = render(<LogGrid day={preciseDay} />);
    const lines = screen.getAllByTestId('duty-segment');
    expect(lines).toHaveLength(6);
    expect(Number(lines[1]!.getAttribute('x1'))).toBeCloseTo(180 + (28801 / 86400) * 780, 8);
    expect(lines[0]).toHaveClass('assumed');
    expect(screen.getAllByTestId('duty-transition')).toHaveLength(5);
    expect(container.querySelectorAll('line').length).toBeGreaterThan(120);
    expect(screen.getAllByText('Sleeper berth')).toHaveLength(1);
    expect(
      [...container.querySelectorAll('.grid-paper-total')].map((element) => element.textContent),
    ).toEqual(expect.arrayContaining(['19', '3', '2']));
    expect(screen.getByTestId('log-total')).toHaveTextContent('24h 0m');
    expect(screen.getByTestId('remarks-band')).toBeInTheDocument();
    expect(screen.getAllByTestId('log-remark')).toHaveLength(2);
    expect(screen.getByText(/Pickup — Gary, IN/)).toBeInTheDocument();
    expect(screen.getByText(/Drop-off — Toledo, OH/)).toBeInTheDocument();
  });

  it('shows a truthful warning when supplied totals are incomplete', () => {
    render(<LogGrid day={{ ...day, totals: { ...day.totals, driving: 10000 } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('do not equal 24 hours');
    expect(screen.getByTestId('log-total')).not.toHaveTextContent('24h 0m');
  });

  it('positions and displays ISO remarks in the fixed log timezone', () => {
    const isoDay = {
      ...day,
      remarks: [
        {
          ...day.remarks[0]!,
          time: '2026-09-21T08:00:01-06:00',
        },
        {
          ...day.remarks[0]!,
          time: '2026-09-21T14:30:00Z',
        },
      ],
    };
    render(<LogGrid day={isoDay} />);
    const remarks = screen.getAllByTestId('log-remark');
    expect(within(remarks[0]!).getByText('08:00')).toBeInTheDocument();
    expect(
      Number(remarks[0]!.querySelector('.grid-remark-connector')?.getAttribute('x1')),
    ).toBeCloseTo(180 + (28801 / 86400) * 780, 8);
    expect(within(remarks[1]!).getByText('08:30')).toBeInTheDocument();
    expect(
      Number(remarks[1]!.querySelector('.grid-remark-connector')?.getAttribute('x1')),
    ).toBeCloseTo(180 + (30600 / 86400) * 780, 8);
  });

  it('labels assumed padding as off duty even when its backend purpose is break', () => {
    const paddedDay = structuredClone(day);
    paddedDay.segments[0]!.purpose = 'break';
    paddedDay.segments[paddedDay.segments.length - 1]!.purpose = 'break';
    render(<DailyLogs trip={{ ...trip, days: [paddedDay] }} />);
    const table = screen.getByRole('table', { name: /Exact duty segments/ });
    const rows = within(table).getAllByRole('row');
    const paddingRow = rows[1]!;
    expect(within(paddingRow).getByText('00:00')).toBeInTheDocument();
    expect(within(paddingRow).getByText('08:00')).toBeInTheDocument();
    expect(within(paddingRow).getByText('8h 0m')).toBeInTheDocument();
    expect(within(paddingRow).getAllByRole('cell')[4]).toHaveTextContent('Assumed off duty');
    expect(within(table).queryByText('30-minute break')).not.toBeInTheDocument();
    expect(within(rows[rows.length - 1]!).getAllByRole('cell')[4]).toHaveTextContent(
      'Assumed off duty',
    );
  });

  it('exposes unknown metadata, exact table, and navigates a full-rest day', async () => {
    const user = userEvent.setup();
    const restingDay = {
      ...day,
      date: '2026-09-22',
      distance_meters: 0,
      totals: { off_duty: 0, sleeper: 86400, driving: 0, on_duty: 0 },
      segments: [
        {
          activity_id: 'rest',
          status: 'sleeper' as const,
          start_second: 0,
          end_second: 86400,
          purpose: 'cycle_restart',
          location: 'Toledo, OH',
          assumed: false,
        },
      ],
      remarks: [
        {
          time: '00:00',
          location: 'Toledo, OH',
          purpose: 'cycle_restart',
          status: 'sleeper',
        },
      ],
    };
    render(<DailyLogs trip={{ ...trip, days: [day, restingDay] }} />);
    expect(screen.getByText('Driver signature')).toHaveTextContent('Not provided');
    expect(screen.getByText('Historical daily recap').nextElementSibling).toHaveTextContent(
      'Not available',
    );
    expect(screen.getByText('PROJECTED / NOT CERTIFIED')).toBeInTheDocument();
    const segments = screen.getByRole('table', { name: /Exact duty segments/ });
    expect(within(segments).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(
      screen.getByRole('article', { name: 'Projected daily log for 2026-09-22' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('log-total')).toHaveTextContent('24h 0m');
    expect(screen.getAllByTestId('duty-segment')).toHaveLength(1);
    expect(screen.getAllByText('Sleeper berth')).toHaveLength(2);
    expect(screen.getAllByTestId('log-remark')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(
      screen.getByRole('article', { name: 'Projected daily log for 2026-09-21' }),
    ).toBeInTheDocument();
  });
});
