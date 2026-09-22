import { Icon } from '../../components/Icon';
import type { ErrorDetail } from '../../types';

interface Props {
  error: ErrorDetail;
  onRefresh: () => void;
}

export function TripErrorBanner({ error, onRefresh }: Props) {
  const additionalFields = Object.entries(error.fields).filter(
    ([key]) => !['current', 'pickup', 'dropoff', 'cycle_used_hours'].includes(key),
  );

  return (
    <div className="banner error-banner trip-error" role="alert">
      <Icon name="info" />
      <div>
        <strong>We couldn’t complete this plan.</strong>
        <p>{error.message}</p>
        {error.request_id && <small>Request reference: {error.request_id}</small>}
        {additionalFields.map(([key, value]) => (
          <p key={key}>{value}</p>
        ))}
        <p>
          Your inputs have been kept. Correct any highlighted fields and try again. If your planning
          context has expired, refresh it below.
        </p>
        <button className="text-button" type="button" onClick={onRefresh}>
          Refresh planning context
        </button>
      </div>
    </div>
  );
}
