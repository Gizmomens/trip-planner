import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon } from '../../components/Icon';
import { tomtomTileUrl } from '../../lib/api';
import { dateTime, purposeLabel } from '../../lib/format';
import type { Trip } from '../../types';

interface Props {
  mapKey: string;
  trip: Trip | null;
  busy: boolean;
  selectedStop: string | null;
  onSelectStop: (id: string) => void;
}

function textElement(tag: string, text: string) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

export function RouteMap({ mapKey, trip, busy, selectedStop, onSelectStop }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routeBounds = useRef<L.LatLngBounds | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const [tileError, setTileError] = useState(false);
  const tileUrl = tomtomTileUrl(mapKey);

  useEffect(() => {
    if (!container.current || !tileUrl) return;
    const currentMarkers = markers.current;
    setTileError(false);
    const instance = L.map(container.current, {
      center: [39.5, -98.3],
      zoom: 4,
      minZoom: 3,
      maxZoom: 20,
      scrollWheelZoom: false,
      zoomControl: false,
    });
    map.current = instance;
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.tileLayer(tileUrl, {
      attribution: '&copy; TomTom',
      maxZoom: 20,
      tileSize: 256,
      crossOrigin: true,
    })
      .on('tileerror', () => setTileError(true))
      .addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      currentMarkers.clear();
      routeBounds.current = null;
    };
  }, [tileUrl]);

  useEffect(() => {
    const instance = map.current;
    const currentMarkers = markers.current;
    currentMarkers.clear();
    routeBounds.current = null;
    if (!instance || !trip) return;
    const layer = L.featureGroup().addTo(instance);
    const coordinates = trip.route.geometry.map(([lon, lat]): L.LatLngTuple => [lat, lon]);
    if (coordinates.length > 1) {
      L.polyline(coordinates, {
        color: '#ffffff',
        weight: 9,
        opacity: 0.95,
        interactive: false,
      }).addTo(layer);
      L.polyline(coordinates, {
        color: '#257ca5',
        weight: 5,
        opacity: 1,
        interactive: false,
      }).addTo(layer);
    }
    trip.locations.forEach((location, index) => {
      const element = textElement('span', String.fromCharCode(65 + index));
      element.className = 'endpoint-dot';
      L.marker([location.lat, location.lon], {
        icon: L.divIcon({
          html: element,
          className: 'endpoint-marker',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: location.name,
      })
        .bindPopup(textElement('strong', location.name))
        .addTo(layer);
    });
    trip.stops.forEach((stop, index) => {
      const markerElement = textElement('span', String(index + 1));
      markerElement.className = 'stop-dot';
      const popup = document.createElement('div');
      popup.className = 'stop-popup';
      popup.append(
        textElement('strong', stop.location.name),
        textElement('span', stop.location.address || 'Address not supplied'),
        textElement('span', stop.purposes.map(purposeLabel).join(' · ')),
        textElement(
          'span',
          `${dateTime(stop.arrival_at)} → ${dateTime(stop.departure_at)} · UTC−06:00`,
        ),
      );
      const marker = L.marker([stop.location.lat, stop.location.lon], {
        icon: L.divIcon({
          html: markerElement,
          className: 'stop-marker',
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        title: `Stop ${index + 1}: ${stop.location.name}`,
        zIndexOffset: 100,
      })
        .bindPopup(popup)
        .on('click', () => onSelectStop(stop.id))
        .addTo(layer);
      currentMarkers.set(stop.id, marker);
    });
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      routeBounds.current = bounds;
      instance.fitBounds(bounds, { padding: [42, 42], maxZoom: 12, animate: false });
    }
    return () => {
      layer.remove();
      currentMarkers.clear();
    };
  }, [trip, tileUrl, onSelectStop]);

  useEffect(() => {
    if (!selectedStop || !map.current) return;
    const marker = markers.current.get(selectedStop);
    if (marker) {
      map.current.panInside(marker.getLatLng(), { padding: [70, 70], animate: false });
      marker.openPopup();
    }
  }, [selectedStop, trip, tileUrl]);

  return (
    <section className="map-panel panel" aria-labelledby="map-heading">
      <div className="panel-header">
        <div>
          <span className="section-eyebrow">THE BIG PICTURE</span>
          <h2 id="map-heading">Route overview</h2>
        </div>
        <span className="subtle-badge">
          <span className="status-dot" />
          {trip ? 'Planned route' : 'Contiguous US'}
        </span>
      </div>
      <div className={`map-surface ${!tileUrl ? 'map-unconfigured' : ''}`}>
        <div
          ref={container}
          className="leaflet-surface"
          role="region"
          aria-label="Route map. The itinerary and directions below provide a text alternative."
        />
        {(!trip || !tileUrl) && (
          <div className={`map-empty ${tileUrl ? 'over-map' : ''}`}>
            <div className="map-empty-icon">
              <Icon name="route" size={36} />
            </div>
            <h3>
              {busy
                ? 'A good plan takes the whole road into account.'
                : trip
                  ? 'Your plan is ready. Map display is unavailable.'
                  : 'Every great trip starts with a plan.'}
            </h3>
            <p>
              {busy
                ? 'Checking your route, real stops, and available driving hours.'
                : trip
                  ? 'Use the complete itinerary, directions, and daily logs below.'
                  : 'Add your three locations and cycle hours. We’ll connect the dots, with room for the stops that matter.'}
            </p>
            {!tileUrl && (
              <span className="map-config-note">
                <Icon name="info" size={15} />
                Map preview requires a configured, restricted public TomTom map key.
              </span>
            )}
            {!trip && !busy && (
              <div className="empty-route-steps">
                <span>A · Start</span>
                <i />
                <span>B · Pickup</span>
                <i />
                <span>C · Delivery</span>
              </div>
            )}
          </div>
        )}
        {tileError && (
          <p className="tile-warning" role="status">
            Map tiles could not load. Check the public map key’s domain restrictions or quota. Your
            route details and logs are still available.
          </p>
        )}
        {tileUrl && trip && (
          <button
            type="button"
            className="map-fit"
            onClick={() => {
              if (routeBounds.current)
                map.current?.fitBounds(routeBounds.current, { padding: [42, 42], maxZoom: 12 });
            }}
          >
            <Icon name="fit" size={17} />
            Fit route
          </button>
        )}
      </div>
      <div className="map-footer">
        <span>
          <span className="route-legend" />
          {trip ? 'Provider road route' : 'Road routing by TomTom'}
        </span>
        <span>
          <Icon name="pin" size={14} />
          Real stops, not estimated pins
        </span>
      </div>
    </section>
  );
}
