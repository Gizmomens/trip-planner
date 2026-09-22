from datetime import datetime, timezone
from math import isfinite

from trips.domain.errors import PlanningError
from trips.domain.models import Activity

HOUR = 3600
BREAK_SECONDS = 30 * 60
BREAK_DRIVING_SECONDS = 8 * HOUR
DAILY_DRIVING_SECONDS = 11 * HOUR
SHIFT_SECONDS = 14 * HOUR
DAILY_REST_SECONDS = 10 * HOUR
CYCLE_SECONDS = 70 * HOUR
RESTART_SECONDS = 34 * HOUR

_PURPOSES = {
    "driving": {"driving"},
    "on_duty": {"pickup", "dropoff", "fuel", "break"},
    "off_duty": {"break", "daily_rest", "cycle_restart"},
    "sleeper": {"break", "daily_rest", "cycle_restart"},
}


def instant(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise PlanningError("invalid_timeline", "Activity times must include a timezone.")
    if value.microsecond:
        raise PlanningError("invalid_timeline", "Activity times must use whole seconds.")
    return value.astimezone(timezone.utc)


class HOSState:
    """Conservative clocks without historical daily recapture or split-sleeper rules."""

    def __init__(self, initial_cycle_seconds: int):
        if type(initial_cycle_seconds) is not int or initial_cycle_seconds < 0:
            raise PlanningError("invalid_cycle", "Initial cycle usage must be nonnegative whole seconds.")
        self._cycle_seconds = initial_cycle_seconds
        self._driving_seconds = 0
        self._break_driving_seconds = 0
        self._non_driving_seconds = 0
        self._rest_seconds = 0
        self._shift_start: datetime | None = None
        self._last_end: datetime | None = None

    @property
    def cycle_seconds(self) -> int:
        return self._cycle_seconds

    @property
    def driving_seconds(self) -> int:
        return self._driving_seconds

    def allowance(self, now: datetime) -> int:
        now = instant(now)
        if self._last_end is not None and now < self._last_end:
            raise PlanningError("invalid_timeline", "Driving capacity cannot be queried in the past.")
        elapsed = int((now - self._shift_start).total_seconds()) if self._shift_start else 0
        return max(0, min(
            BREAK_DRIVING_SECONDS - self._break_driving_seconds,
            DAILY_DRIVING_SECONDS - self._driving_seconds,
            SHIFT_SECONDS - elapsed,
            CYCLE_SECONDS - self._cycle_seconds,
        ))

    def apply(self, activity: Activity) -> None:
        start = instant(activity.start_at)
        end = instant(activity.end_at)
        duration = int((end - start).total_seconds())
        if duration <= 0:
            raise PlanningError("invalid_timeline", "Activities must have positive duration.")
        if self._last_end is not None and start != self._last_end:
            raise PlanningError("invalid_timeline", "Activities must be contiguous and chronological.")
        if activity.status not in _PURPOSES or activity.purpose not in _PURPOSES[activity.status]:
            raise PlanningError("invalid_timeline", "The activity purpose does not match its duty status.")
        distance = activity.distance_meters
        if isinstance(distance, bool) or not isinstance(distance, (int, float)) or not isfinite(distance) or distance < 0:
            raise PlanningError("invalid_timeline", "Activity distance must be finite and nonnegative.")
        if activity.status != "driving" and (distance != 0 or activity.progress):
            raise PlanningError("invalid_timeline", "Only driving activities can contain route mileage.")
        if activity.status == "driving" and duration > self.allowance(start):
            raise PlanningError("hos_limit", "Driving would exceed the available break, daily, shift or cycle limit.")

        if activity.status in {"driving", "on_duty"}:
            if self._shift_start is None:
                self._shift_start = start
            self._cycle_seconds += duration
            self._rest_seconds = 0
        else:
            self._rest_seconds += duration
            if self._rest_seconds >= DAILY_REST_SECONDS:
                self._driving_seconds = 0
                self._shift_start = None
            if self._rest_seconds >= RESTART_SECONDS:
                self._cycle_seconds = 0

        if activity.status == "driving":
            self._driving_seconds += duration
            self._break_driving_seconds += duration
            self._non_driving_seconds = 0
        else:
            self._non_driving_seconds += duration
            if self._non_driving_seconds >= BREAK_SECONDS:
                self._break_driving_seconds = 0
        self._last_end = end
