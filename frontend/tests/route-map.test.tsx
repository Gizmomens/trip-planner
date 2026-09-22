import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteMap } from '../src/features/route-plan/RouteMap';
import { trip } from './fixtures';

const validKey = 'restricted_public_test_key_12345';
const originalSvg = L.Browser.svg;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(L.Browser, 'svg', { value: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(L.Browser, 'svg', { value: originalSvg, configurable: true });
  vi.unstubAllGlobals();
});

describe('TomTom-only Leaflet map', () => {
  it('releases each map and observer during StrictMode replay and unmount', () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {
          disconnect();
        }
      },
    );
    const remove = vi.spyOn(L.Map.prototype, 'remove');
    const { container, unmount } = render(
      <StrictMode>
        <RouteMap
          mapKey={validKey}
          trip={trip}
          busy={false}
          selectedStop={null}
          onSelectStop={vi.fn()}
        />
      </StrictMode>,
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.stop-marker')).toHaveLength(2);
    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.leaflet-container')).toBeNull();
  });

  it('requests tiles only from the allowed endpoint and shows provider attribution', () => {
    const { container } = render(
      <RouteMap
        mapKey={validKey}
        trip={trip}
        busy={false}
        selectedStop={null}
        onSelectStop={vi.fn()}
      />,
    );
    const tiles = Array.from(container.querySelectorAll<HTMLImageElement>('.leaflet-tile'));
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles)
      expect(tile.src).toMatch(
        /^https:\/\/api\.tomtom\.com\/map\/1\/tile\/basic\/main\/\d+\/\d+\/\d+\.png\?key=restricted_public_test_key_12345$/,
      );
    expect(container.querySelector('.leaflet-control-attribution')).toHaveTextContent('TomTom');
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(2);
  });

  it('synchronizes marker selections by stop ID and uses safe DOM popup text', () => {
    const onSelect = vi.fn();
    const unsafeName = '<img src=x onerror=alert(1)> Warehouse';
    const result = {
      ...trip,
      stops: [
        { ...trip.stops[0]!, location: { ...trip.stops[0]!.location, name: unsafeName } },
        trip.stops[1]!,
      ],
    };
    const { container, rerender } = render(
      <RouteMap
        mapKey={validKey}
        trip={result}
        busy={false}
        selectedStop={null}
        onSelectStop={onSelect}
      />,
    );
    const marker = Array.from(container.querySelectorAll<HTMLElement>('.stop-marker')).find(
      (element) => element.title.includes('Warehouse'),
    )!;
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenCalledWith('stop-pickup');
    expect(container.querySelector('.leaflet-popup-content')).toHaveTextContent(unsafeName);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    rerender(
      <RouteMap
        mapKey={validKey}
        trip={result}
        busy={false}
        selectedStop="stop-dropoff"
        onSelectStop={onSelect}
      />,
    );
    expect(container.querySelector('.leaflet-popup-content')).toHaveTextContent('Toledo delivery');
  });

  it('keeps the valid route and markers when a tile fails', () => {
    const { container } = render(
      <RouteMap
        mapKey={validKey}
        trip={trip}
        busy={false}
        selectedStop={null}
        onSelectStop={vi.fn()}
      />,
    );
    const tile = container.querySelector('.leaflet-tile')!;
    act(() => fireEvent.error(tile));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your route details and logs are still available',
    );
    expect(container.querySelectorAll('.stop-marker')).toHaveLength(2);
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(2);
  });

  it('never requests external tiles without a valid public key', () => {
    const { container } = render(
      <RouteMap
        mapKey="https://untrusted.invalid"
        trip={trip}
        busy={false}
        selectedStop={null}
        onSelectStop={vi.fn()}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Your plan is ready. Map display is unavailable.')).toBeInTheDocument();
  });
});
