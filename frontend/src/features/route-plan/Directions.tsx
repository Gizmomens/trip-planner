import { Icon } from '../../components/Icon';
import { duration, miles } from '../../lib/format';
import type { Trip } from '../../types';

export function Directions({ trip }: { trip: Trip | null }) {
  return (
    <section className="directions-panel panel" aria-labelledby="directions-heading">
      <div className="panel-header">
        <div>
          <span className="section-eyebrow">KNOW THE WAY</span>
          <h2 id="directions-heading">Road directions</h2>
        </div>
        <Icon name="route" size={22} />
      </div>
      {!trip ? (
        <div className="compact-empty">
          <div className="empty-icon">
            <Icon name="route" size={26} />
          </div>
          <h3>More than a line on a map.</h3>
          <p>
            Readable turn-by-turn directions
            <br />
            from your accepted road route.
          </p>
        </div>
      ) : trip.route.instructions.length === 0 ? (
        <p className="empty-instructions">
          No road maneuvers were returned for this route. See the itinerary for the planned
          activities.
        </p>
      ) : (
        <ol className="direction-list">
          {trip.route.instructions.map((instruction, index) => (
            <li key={`${index}-${instruction.text}`}>
              <span className="direction-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <p>{instruction.text}</p>
                <span>
                  {miles(instruction.distance_meters)} mi · {duration(instruction.travel_seconds)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="directions-disclaimer">
        <Icon name="info" size={14} />
        Planning guidance, not live navigation. Verify truck access and road restrictions.
      </p>
    </section>
  );
}
