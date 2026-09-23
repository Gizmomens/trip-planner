import { Icon } from './Icon';
import { assumptionsFor, type AssumptionId } from '../lib/assumptions';
import type { Bootstrap } from '../types';

export function Assumptions({
  assumptionIds,
  limits,
}: {
  assumptionIds: AssumptionId[];
  limits?: Bootstrap['limits'];
}) {
  const assumptions = assumptionsFor(assumptionIds);
  return (
    <details className="assumptions panel" id="planning-assumptions">
      <summary>
        <Icon name="info" size={19} />
        <span>
          <strong>A clear plan starts with clear assumptions.</strong>
          <span>Fresh shift · fixed UTC−06:00 · generic truck route · projected records</span>
        </span>
        <span className="assumptions-toggle">View details</span>
      </summary>
      <div className="assumptions-content">
        <p>
          Assessment planning, not a certified compliance or navigation system. Start at 08:00 after
          at least 10 hours off duty and with a full tank. Pickup and drop-off each take one hour.
        </p>
        <p>
          Plans use full daily rests and a conservative 70-hour / 8-day cycle with 34-hour restarts
          when needed. No split-sleeper optimization or invented historical recapture.
        </p>
        <p>
          Real provider-listed facilities are assumed usable at any time. Parking, opening hours,
          overnight permission, fuel availability, and vehicle-specific clearance are not verified.
        </p>
        {assumptions.length > 0 && (
          <ul>
            {assumptions.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </li>
            ))}
          </ul>
        )}
        {limits && (
          <p className="limits-note">
            Application limits: {limits.days} calendar days · {limits.facilities} inserted facility
            visits · {limits.provider_requests} provider requests per generation ·{' '}
            {limits.processing_seconds} seconds of processing. Reaching a limit returns an error,
            not a partial success.
          </p>
        )}
      </div>
    </details>
  );
}
