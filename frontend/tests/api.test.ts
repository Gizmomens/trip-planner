import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/lib/api';
import { bootstrap, locations, trip } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('same-origin API boundary', () => {
  it('uses relative paths and no-store same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(bootstrap));
    vi.stubGlobal('fetch', fetchMock);
    await api.bootstrap(new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/bootstrap',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('encodes address queries and returns a normalized structured error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'upstream_quota',
            message: 'Provider quota is exhausted.',
            request_id: 'ref-123',
            fields: { current: 'Try a specific address.', invalid: { unsafe: true } },
          },
        },
        { status: 429 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.locations(' A&B, IL ', new AbortController().signal)).rejects.toMatchObject({
      status: 429,
      detail: {
        code: 'upstream_quota',
        message: 'Provider quota is exhausted.',
        fields: { current: 'Try a specific address.' },
        request_id: 'ref-123',
      },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/locations?q=A%26B%2C%20IL');
  });

  it('does not expose raw non-JSON server output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>server diagnostics</html>', { status: 502 })),
    );
    const result = api.bootstrap(new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({
      message: 'The planning service returned an unreadable response. Please try again.',
    });
  });

  it('preserves abort behavior rather than converting cancellation into network failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const reason = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason));
    await expect(api.bootstrap(controller.signal)).rejects.toBe(reason);
  });
});

const tripInput = {
  current: 'current-token',
  pickup: 'pickup-token',
  dropoff: 'dropoff-token',
  cycle_used_hours: 10,
  planning_token: bootstrap.planning_token,
};
const endpoints = [
  {
    name: 'bootstrap',
    valid: bootstrap,
    request: () => api.bootstrap(new AbortController().signal),
  },
  {
    name: 'locations',
    valid: { locations },
    request: () => api.locations('Chicago', new AbortController().signal),
  },
  {
    name: 'trip',
    valid: trip,
    request: () => api.trip(tripInput, bootstrap.csrf_token, new AbortController().signal),
  },
];

describe('successful response validation', () => {
  it.each(endpoints)('returns the valid $name fixture unchanged', async (endpoint) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(endpoint.valid)));
    await expect(endpoint.request()).resolves.toEqual(endpoint.valid);
  });

  describe.each(endpoints)('$name root validation', (endpoint) => {
    it.each([null, [], 'unexpected response', 123, true, {}])(
      'rejects a malformed HTTP 200 root: %j',
      async (body) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
        const result = endpoint.request();
        await expect(result).rejects.toBeInstanceOf(ApiError);
        await expect(result).rejects.toMatchObject({
          status: 200,
          detail: {
            code: 'invalid_response',
            message:
              'The planning service returned an incomplete or invalid response. Please try again.',
            fields: {},
            request_id: '',
          },
        });
      },
    );
  });

  it('rejects missing nested trip summary before returning any result', async () => {
    const incomplete: Partial<typeof trip> = { ...trip };
    delete incomplete.summary;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(incomplete)));
    await expect(
      api.trip(tripInput, bootstrap.csrf_token, new AbortController().signal),
    ).rejects.toMatchObject({
      detail: { code: 'invalid_response' },
    });
  });

  it('rejects non-finite numbers parsed from a successful JSON response', async () => {
    const body = JSON.stringify(trip).replace(
      '"distance_meters":96560.64',
      '"distance_meters":1e309',
    );
    expect(JSON.parse(body).activities[0].distance_meters).toBe(Infinity);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(
      api.trip(tripInput, bootstrap.csrf_token, new AbortController().signal),
    ).rejects.toMatchObject({
      detail: { code: 'invalid_response' },
    });
  });

  it('requires selectable signed tokens for every lookup result rather than dropping invalid entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ locations: [locations[0], { ...locations[1], token: '' }] }),
        ),
    );
    await expect(api.locations('Chicago', new AbortController().signal)).rejects.toMatchObject({
      detail: { code: 'invalid_response' },
    });
  });

  it('keeps trip request headers, body, credentials, and cancellation signal intact', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(trip));
    vi.stubGlobal('fetch', fetchMock);
    await api.trip(tripInput, bootstrap.csrf_token, controller.signal);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/trips', {
      credentials: 'same-origin',
      cache: 'no-store',
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRFToken': bootstrap.csrf_token,
      },
      body: JSON.stringify(tripInput),
    });
  });
});
