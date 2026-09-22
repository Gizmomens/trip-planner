from math import fsum, isfinite

from trips.domain.assumptions import FUEL_RANGE_METERS
from trips.domain.errors import PlanningError
from trips.domain.hos import BREAK_SECONDS, HOSState, instant
from trips.domain.models import Activity


def _validate_progress(activity: Activity) -> None:
    if not activity.progress:
        return
    duration = (instant(activity.end_at) - instant(activity.start_at)).total_seconds()
    previous_seconds = previous_meters = 0.0
    for point in activity.progress:
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value)
               for value in (point.seconds, point.meters, point.lon, point.lat)):
            raise PlanningError("invalid_timeline", "Route progress must contain finite numbers.")
        if not (previous_seconds <= point.seconds <= duration
                and previous_meters <= point.meters <= activity.distance_meters):
            raise PlanningError("invalid_timeline", "Route progress must be cumulative within its activity.")
        if not (-180 <= point.lon <= 180 and -90 <= point.lat <= 90):
            raise PlanningError("invalid_timeline", "Route progress coordinates are invalid.")
        previous_seconds, previous_meters = point.seconds, point.meters
    first, last = activity.progress[0], activity.progress[-1]
    if first.seconds != 0 or first.meters != 0 or last.meters != activity.distance_meters:
        raise PlanningError("invalid_timeline", "Route progress must cover the activity's full distance.")
    if activity.distance_meters > 0 and last.seconds <= 0:
        raise PlanningError("invalid_timeline", "Positive route mileage requires positive travel time.")


def validate_timeline(activities: list[Activity], initial_cycle_seconds: int) -> HOSState:
    """Replay accepted activities independently of the planner's mutable search state."""
    state = HOSState(initial_cycle_seconds)
    ids: set[str] = set()
    fuel_distances: list[float] = []
    previous: Activity | None = None
    for activity in activities:
        if not isinstance(activity.id, str) or not activity.id or activity.id in ids:
            raise PlanningError("invalid_timeline", "Activity identifiers must be nonempty and unique.")
        state.apply(activity)
        _validate_progress(activity)
        start = (activity.start_location.lat, activity.start_location.lon)
        end = (activity.end_location.lat, activity.end_location.lon)
        if activity.status != "driving" and start != end:
            raise PlanningError("invalid_timeline", "A non-driving activity cannot change location.")
        if previous and start != (previous.end_location.lat, previous.end_location.lon):
            raise PlanningError("invalid_timeline", "Adjacent activities must meet at the same location.")
        if activity.status == "driving":
            fuel_distances.append(activity.distance_meters)
            if fsum(fuel_distances) > FUEL_RANGE_METERS:
                raise PlanningError("fuel_limit", "Driving exceeds 1,000 routed miles since completed fueling.")
        elif activity.purpose == "fuel":
            duration = (instant(activity.end_at) - instant(activity.start_at)).total_seconds()
            if activity.status != "on_duty" or duration < BREAK_SECONDS:
                raise PlanningError("invalid_fuel", "Fueling requires at least 30 minutes on duty.")
            fuel_distances.clear()
        ids.add(activity.id)
        previous = activity
    return state
