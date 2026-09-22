import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { bootstrap, locations, trip } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('malformed success recovery', () => {
  it('keeps form inputs, shows a recoverable error, and allows retry after an HTTP 200 trip without a summary', async () => {
    const malformed: Partial<typeof trip> = { ...trip };
    delete malformed.summary;
    let submissionCount = 0;
    const fetchMock = vi.fn((path: string, init?: RequestInit): Promise<Response> => {
      if (path.endsWith('/bootstrap')) return Promise.resolve(Response.json(bootstrap));
      if (path.includes('/locations?')) {
        const query = new URL(path, 'http://localhost').searchParams.get('q') ?? '';
        return Promise.resolve(
          Response.json({
            locations: locations.filter((location) =>
              location.name.toLowerCase().includes(query.toLowerCase()),
            ),
          }),
        );
      }
      if (path.endsWith('/trips') && init?.method === 'POST') {
        submissionCount++;
        return Promise.resolve(Response.json(submissionCount === 1 ? malformed : trip));
      }
      return Promise.reject(new Error('Unexpected test request'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Mon, Sep 21, 2026');
    for (const field of [
      { label: 'Current location', query: 'Chicago' },
      { label: 'Pickup location', query: 'Gary' },
      { label: 'Drop-off location', query: 'Toledo' },
    ]) {
      await user.type(screen.getByRole('combobox', { name: new RegExp(field.label) }), field.query);
      await user.click(await screen.findByRole('option'));
    }
    await user.type(screen.getByRole('spinbutton', { name: /Prior cycle hours used/ }), '12.5');
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The planning service returned an incomplete or invalid response. Please try again.',
    );
    expect(alert).toHaveTextContent('Your inputs have been kept');
    expect(screen.queryByRole('heading', { name: 'Your trip plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Current location/ })).toHaveValue('Chicago');
    expect(screen.getByRole('combobox', { name: /Pickup location/ })).toHaveValue('Gary warehouse');
    expect(screen.getByRole('combobox', { name: /Drop-off location/ })).toHaveValue(
      'Toledo delivery',
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(12.5);
    expect(screen.getByRole('button', { name: 'Generate trip plan' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(await screen.findByRole('heading', { name: 'Your trip plan' })).toBeInTheDocument();
    expect(
      screen.getByRole('article', { name: 'Projected daily log for 2026-09-21' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    const submissions = fetchMock.mock.calls.filter(([path]) => path.endsWith('/trips'));
    expect(submissions).toHaveLength(2);
    expect(submissions[0]?.[1]?.body).toBe(submissions[1]?.[1]?.body);
  });
});
