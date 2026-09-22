import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationSearch } from '../src/features/trip-form/LocationSearch';
import type { Location } from '../src/types';
import { deferred, locations } from './fixtures';

function SearchHarness() {
  const [location, setLocation] = useState<Location | null>(null);
  return (
    <>
      <LocationSearch
        field="current"
        label="Current location"
        number="A"
        placeholder="Search"
        selected={location}
        onChange={setLocation}
        enabled
      />
      <output>{location?.token ?? 'Not selected'}</output>
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('live location lookup', () => {
  it('waits for three trimmed characters before requesting matches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ locations: [locations[0]] }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SearchHarness />);
    const input = screen.getByRole('combobox');
    await user.type(input, ' Ch ');
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, ' Chi ');
    expect(await screen.findByRole('option')).toHaveTextContent('Chicago');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/locations?q=Chi',
      expect.any(Object),
    );
    expect(
      screen.queryByRole('button', { name: /Search current location/ }),
    ).not.toBeInTheDocument();
  });

  it('queries after typing, supports keyboard selection, and invalidates a choice on edit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ locations: [locations[0]] })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SearchHarness />);
    const input = screen.getByRole('combobox', { name: /Current location/ });
    await user.type(input, 'Chicago');
    expect(await screen.findByRole('option')).toHaveTextContent('Chicago, IL');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByText('signed-current')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Clear current location' }));
    expect(screen.getByText('Not selected')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts and ignores an old query when the input is edited', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ locations: [locations[1]] })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SearchHarness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'Chicago');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.clear(input);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
    await user.type(input, 'Gary');
    expect(await screen.findByRole('option')).toHaveTextContent('Gary warehouse');
    await act(async () =>
      pending.resolve(new Response(JSON.stringify({ locations: [locations[0]] }))),
    );
    await waitFor(() => expect(screen.getByRole('option')).toHaveTextContent('Gary warehouse'));
  });

  it('scrolls only the result list to keep keyboard-active options visible', async () => {
    const matches = Array.from({ length: 6 }, (_, index) => ({
      ...locations[0],
      id: `match-${index}`,
      name: `Match ${index}`,
      token: `signed-${index}`,
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ locations: matches })));
    const pageScroll = vi.spyOn(window, 'scrollTo');
    const user = userEvent.setup();
    render(<SearchHarness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'Chicago');
    const options = await screen.findAllByRole('option');
    const list = screen.getByRole('listbox');
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 260, 234));
    Object.defineProperties(list, {
      clientTop: { configurable: true, value: 2 },
      clientHeight: { configurable: true, value: 230 },
    });
    options.forEach((option, index) => {
      vi.spyOn(option, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(2, 102 + index * 50 - list.scrollTop, 256, 50),
      );
    });

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(list.scrollTop).toBe(0);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(list.scrollTop).toBe(70);
    expect(input).toHaveAttribute('aria-activedescendant', options[5]?.id);
    expect(input).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(list.scrollTop).toBe(70);
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(list.scrollTop).toBe(0);
    expect(input).toHaveFocus();
    expect(pageScroll).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(screen.getByText('signed-0')).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('shows empty results and errors without silently selecting a location', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ locations: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'rate_limited',
              message: 'Too many lookups. Please wait.',
              fields: {},
              request_id: 'lookup-1',
            },
          }),
          { status: 429 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SearchHarness />);
    await user.type(screen.getByRole('combobox'), 'Nowhere');
    expect(await screen.findByText(/No selectable matches/)).toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), ' else');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many lookups');
    expect(screen.getByText('Not selected')).toBeInTheDocument();
  });
});
