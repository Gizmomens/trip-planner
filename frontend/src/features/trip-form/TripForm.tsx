import { useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { dateLabel, TIME_BASIS } from '../../lib/format';
import type { Bootstrap, Location, LocationField, TripInput } from '../../types';
import { LocationSearch } from './LocationSearch';

interface Props {
  bootstrap: Bootstrap | null;
  busy: boolean;
  errors: Record<string, string>;
  onEdit: () => void;
  onSubmit: (input: TripInput) => void;
  onCancel: () => void;
}

const fields = [
  {
    field: 'current',
    label: 'Current location',
    number: 'A',
    placeholder: 'Where are you starting?',
  },
  { field: 'pickup', label: 'Pickup location', number: 'B', placeholder: 'Where is the pickup?' },
  {
    field: 'dropoff',
    label: 'Drop-off location',
    number: 'C',
    placeholder: 'Where are you delivering?',
  },
] as const;

export function TripForm({ bootstrap, busy, errors, onEdit, onSubmit, onCancel }: Props) {
  const [locations, setLocations] = useState<Record<LocationField, Location | null>>({
    current: null,
    pickup: null,
    dropoff: null,
  });
  const [cycle, setCycle] = useState('');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const fieldErrors = { ...errors, ...localErrors };
  const cycleNumber = Number(cycle);

  function edit() {
    setLocalErrors({});
    onEdit();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !bootstrap?.provider_ready) return;

    const nextErrors: Record<string, string> = {};
    for (const { field } of fields) {
      if (!locations[field]?.token) nextErrors[field] = 'Search and select a location to continue.';
    }
    if (
      cycle.trim() === '' ||
      !Number.isFinite(cycleNumber) ||
      cycleNumber < 0 ||
      cycleNumber > 192
    ) {
      nextErrors.cycle_used_hours = 'Enter a finite number of hours from 0 to 192.';
    }
    setLocalErrors(nextErrors);

    const current = locations.current?.token;
    const pickup = locations.pickup?.token;
    const dropoff = locations.dropoff?.token;
    if (Object.keys(nextErrors).length || !current || !pickup || !dropoff) {
      const first = Object.keys(nextErrors)[0];
      if (first) event.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    onSubmit({
      current,
      pickup,
      dropoff,
      cycle_used_hours: cycleNumber,
      planning_token: bootstrap.planning_token,
    });
  }

  return (
    <aside className="planner-sidebar" aria-labelledby="form-heading">
      <div className="section-eyebrow">
        <span className="eyebrow-dot" /> YOUR NEXT HAUL
      </div>
      <h2 id="form-heading">A better road ahead.</h2>
      <p className="section-description">
        Your route, rest stops, and daily logs.
        <br />
        One thoughtfully planned trip.
      </p>
      <form noValidate onSubmit={handleSubmit}>
        <div className="location-fields">
          {fields.map((field) => (
            <LocationSearch
              key={field.field}
              {...field}
              selected={locations[field.field]}
              error={fieldErrors[field.field]}
              enabled={Boolean(bootstrap?.provider_ready)}
              onChange={(location) => {
                edit();
                setLocations((current) => ({ ...current, [field.field]: location }));
              }}
            />
          ))}
        </div>
        <div className="cycle-field">
          <label htmlFor="cycle-hours">
            <Icon name="clock" size={17} />
            Prior cycle hours used
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          </label>
          <div className={`cycle-control ${fieldErrors.cycle_used_hours ? 'is-invalid' : ''}`}>
            <input
              id="cycle-hours"
              name="cycle_used_hours"
              type="number"
              min="0"
              max="192"
              step="any"
              required
              inputMode="decimal"
              placeholder="Hours"
              value={cycle}
              aria-invalid={Boolean(fieldErrors.cycle_used_hours)}
              aria-describedby={`cycle-hint${fieldErrors.cycle_used_hours ? ' cycle-error' : ''}`}
              onChange={(event) => {
                edit();
                setCycle(event.target.value);
              }}
            />
            <span>hours already used</span>
          </div>
          <p className="field-hint" id="cycle-hint">
            Driving plus other on-duty hours accumulated before this trip in the current 70-hour /
            8-day cycle. This is not today’s driving time or the daily 11- and 14-hour clocks. Enter
            0 for a fresh cycle; at 70+ hours, the plan adds a 34-hour restart before more driving.
          </p>
          {fieldErrors.cycle_used_hours && (
            <p id="cycle-error" className="field-error" role="alert">
              {fieldErrors.cycle_used_hours}
            </p>
          )}
          {cycle !== '' &&
            Number.isFinite(cycleNumber) &&
            cycleNumber >= 70 &&
            cycleNumber <= 192 && (
              <p className="restart-note">
                <Icon name="info" size={16} />A 34-hour restart will be planned before further
                driving.
              </p>
            )}
        </div>
        <div className="departure-note">
          <Icon name="calendar" size={19} />
          <div>
            <strong>
              {bootstrap ? dateLabel(bootstrap.departure_at) : 'Loading planning date…'}
            </strong>
            <span>Departure 08:00 · fixed {TIME_BASIS}</span>
          </div>
        </div>
        <button
          className="button primary generate-button"
          type="submit"
          disabled={busy || !bootstrap?.provider_ready}
        >
          {busy ? (
            <>
              <span className="spinner" />
              Planning your trip…
            </>
          ) : (
            <>
              Generate trip plan
              <Icon name="arrow" size={18} />
            </>
          )}
        </button>
        {busy && (
          <div className="planning-progress" role="status">
            <p>
              Finding a road route and checking real stops against your available hours. This can
              take up to {bootstrap?.limits.processing_seconds ?? 120} seconds.
            </p>
            <button className="text-button" type="button" onClick={onCancel}>
              Cancel planning
            </button>
          </div>
        )}
        <p className="form-footnote">
          <Icon name="shield" size={14} />
          No account. No saved trips. Just a plan.
        </p>
      </form>
      <div className="planning-principles">
        <span className="section-eyebrow">BUILT INTO EVERY PLAN</span>
        <p>
          <Icon name="check" size={15} />
          Driving, break & rest limits
        </p>
        <p>
          <Icon name="check" size={15} />
          Real fuel and rest locations
        </p>
        <p>
          <Icon name="check" size={15} />
          Projected daily log sheets
        </p>
      </div>
    </aside>
  );
}
