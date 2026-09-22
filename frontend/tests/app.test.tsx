import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import type { Bootstrap } from '../src/types';
import { bootstrap, deferred, locations, trip } from './fixtures';

function mockApi(
  options: {
    config?: Bootstrap;
    submit?: () => Response | Promise<Response>;
    bootstrapFailure?: boolean;
  } = {},
) {
  const fetchMock = vi.fn((path: string, init?: RequestInit): Promise<Response> => {
    if (path.endsWith('/bootstrap')) {
      if (options.bootstrapFailure) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(Response.json(options.config ?? bootstrap));
    }
    if (path.includes('/locations?')) {
      const query = new URL(path, 'http://localhost').searchParams.get('q')!.toLowerCase();
      return Promise.resolve(
        Response.json({
          locations: locations.filter((location) => location.name.toLowerCase().includes(query)),
        }),
      );
    }
    if (path.endsWith('/trips') && init?.method === 'POST')
      return Promise.resolve(options.submit ? options.submit() : Response.json(trip));
    return Promise.reject(new Error(`Unexpected test endpoint: ${path}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, cycle: string | null = '10') {
  await screen.findByText('Mon, Sep 21, 2026');
  for (const [label, query] of [
    ['Current location', 'Chicago'],
    ['Pickup location', 'Gary'],
    ['Drop-off location', 'Toledo'],
  ]) {
    await user.type(screen.getByRole('combobox', { name: new RegExp(label!) }), query!);
    await user.click(await screen.findByRole('option'));
  }
  if (cycle !== null) {
    await user.type(screen.getByRole('spinbutton', { name: /Prior cycle hours used/ }), cycle);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('four-input planning workspace', () => {
  it('submits signed selections with same-origin CSRF and renders the returned plan', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    const { container } = render(<App />);
    expect(container.querySelectorAll('input[required]')).toHaveLength(4);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(await screen.findByRole('heading', { name: 'Your trip plan' })).toBeInTheDocument();
    expect(screen.getByText('Follow I-90 east toward Gary.')).toBeInTheDocument();
    expect(
      screen.getByRole('article', { name: 'Projected daily log for 2026-09-21' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Facility access is assumed, not verified.')).not.toBeInTheDocument();
    expect(screen.queryByText('Keep these details in mind')).not.toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([path]) => path.endsWith('/trips'))!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      current: 'signed-current',
      pickup: 'signed-pickup',
      dropoff: 'signed-dropoff',
      cycle_used_hours: 10,
      planning_token: 'signed-planning-context',
    });
    expect(post[1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      method: 'POST',
      headers: { 'X-CSRFToken': 'csrf-test-token', 'Content-Type': 'application/json' },
    });
    expect(container.querySelector('.leaflet-tile')).toBeNull();
    await user.type(screen.getByRole('combobox', { name: /Pickup location/ }), ' changed');
    expect(screen.queryByRole('heading', { name: 'Your trip plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(
      await screen.findByText('Search and select a location to continue.'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/trips'))).toHaveLength(1);
  });

  it('rejects missing selections and negative hours without a planning request', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Mon, Sep 21, 2026');
    await user.type(screen.getByRole('spinbutton'), '-1');
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(screen.getAllByText('Search and select a location to continue.')).toHaveLength(3);
    expect(screen.getByText('Enter a finite number of hours from 0 to 192.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Current location/ })).toHaveFocus();
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/trips'))).toHaveLength(0);
  });

  it('shows an honest empty placeholder and accepts an explicitly entered zero', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await fillForm(user, null);
    const cycleInput = screen.getByRole('spinbutton', { name: /Prior cycle hours used/ });
    expect(cycleInput).toHaveValue(null);
    expect(cycleInput).toHaveAttribute('placeholder', 'Hours');
    await user.type(cycleInput, '0');
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(await screen.findByRole('heading', { name: 'Your trip plan' })).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([path]) => path.endsWith('/trips'))!;
    expect(JSON.parse(post[1]!.body as string).cycle_used_hours).toBe(0);
  });

  it('supports exhausted cycles, renders server field errors, and keeps input values', async () => {
    mockApi({
      submit: () =>
        Response.json(
          {
            error: {
              code: 'invalid_location',
              message: 'The delivery location needs a new selection.',
              fields: { dropoff: 'Please search this location again.' },
              request_id: 'safe-reference-1',
            },
          },
          { status: 422 },
        ),
    });
    const user = userEvent.setup();
    render(<App />);
    await fillForm(user, '72.5');
    expect(screen.getByText(/A 34-hour restart will be planned/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(
      await screen.findByText('The delivery location needs a new selection.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Please search this location again.')).toBeInTheDocument();
    expect(screen.getByText('Request reference: safe-reference-1')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Drop-off location/ })).toHaveValue(
      'Toledo delivery',
    );
    expect(screen.getByRole('combobox', { name: /Drop-off location/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(72.5);
  });

  it('enforces the physical 192-hour maximum while accepting the exact boundary', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await fillForm(user, '192.01');
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '192');
    expect(
      screen.getByText(/Driving plus other on-duty hours accumulated before this trip/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(screen.getByText('Enter a finite number of hours from 0 to 192.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/trips'))).toHaveLength(0);
    await user.clear(input);
    await user.type(input, '192');
    expect(screen.getByText(/A 34-hour restart will be planned/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(await screen.findByRole('heading', { name: 'Your trip plan' })).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([path]) => path.endsWith('/trips'))!;
    expect(JSON.parse(post[1]!.body as string).cycle_used_hours).toBe(192);
  });

  it('prevents duplicate generation and rejects a stale result after edits', async () => {
    const pending = deferred<Response>();
    const fetchMock = mockApi({ submit: () => pending.promise });
    const user = userEvent.setup();
    render(<App />);
    await fillForm(user);
    await user.dblClick(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(screen.getByRole('button', { name: 'Planning your trip…' })).toBeDisabled();
    expect(screen.getByText(/Finding a road route/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/trips'))).toHaveLength(1);
    await user.type(screen.getByRole('spinbutton'), '1');
    const post = fetchMock.mock.calls.find(([path]) => path.endsWith('/trips'))!;
    expect(post[1]?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(Response.json(trip)));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate trip plan' })).toBeEnabled();
    expect(screen.getByText(/Inputs changed/, { selector: 'p' })).toBeInTheDocument();
  });

  it('cancels planning without discarding the form or accepting late output', async () => {
    const pending = deferred<Response>();
    mockApi({ submit: () => pending.promise });
    const user = userEvent.setup();
    render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    await user.click(screen.getByRole('button', { name: 'Cancel planning' }));
    expect(screen.getByRole('combobox', { name: /Pickup location/ })).toHaveValue('Gary warehouse');
    expect(screen.getByText(/Planning cancelled/, { selector: 'p' })).toBeInTheDocument();
    await act(async () => pending.resolve(Response.json(trip)));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('aborts an in-flight plan on unmount under the real StrictMode wrapper', async () => {
    const pending = deferred<Response>();
    const fetchMock = mockApi({ submit: () => pending.promise });
    const user = userEvent.setup();
    const { container, unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    const submission = fetchMock.mock.calls.find(([path]) => path.endsWith('/trips'));
    expect(submission?.[1]?.signal?.aborted).toBe(false);
    unmount();
    expect(submission?.[1]?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(Response.json(trip)));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a missing-configuration banner and usable form without a fake plan or external tiles', async () => {
    const fetchMock = mockApi({ config: { ...bootstrap, provider_ready: false } });
    const user = userEvent.setup();
    const { container } = render(<App />);
    expect(await screen.findByText('A quick setup before your first trip.')).toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: /Current location/ }), 'Chicago');
    expect(screen.getByRole('button', { name: 'Generate trip plan' })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Search current location' }),
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll('input[required]')).toHaveLength(4);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers from an unavailable backend through an explicit retry', async () => {
    const options = { bootstrapFailure: true };
    mockApi(options);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load');
    options.bootstrapFailure = false;
    await user.click(screen.getByRole('button', { name: 'Retry connection' }));
    expect(await screen.findByText('Mon, Sep 21, 2026')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('button', { name: 'Generate trip plan' })).toBeEnabled();
  });

  it('renders provider direction text literally rather than as HTML', async () => {
    const unsafeText = '<img src=x onerror=alert(1)> Turn right';
    mockApi({
      submit: () =>
        Response.json({
          ...trip,
          route: {
            ...trip.route,
            instructions: [{ ...trip.route.instructions[0], text: unsafeText }],
          },
        }),
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Generate trip plan' }));
    expect(await screen.findByText(unsafeText)).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });
});
