from bisect import bisect_right
from dataclasses import replace
from datetime import datetime, time, timedelta
from math import fsum

from trips.domain.assumptions import TERMINAL_TZ
from trips.domain.hos import CYCLE_SECONDS, HOUR, HOSState, instant
from trips.domain.models import Activity, Location
from trips.domain.validation import validate_timeline

_STATUSES = ("off_duty", "sleeper", "driving", "on_duty")


def _label(location: Location) -> str:
    return location.address.strip() or location.name.strip() or "Location not provided"


def _location_at(activity: Activity, when: datetime) -> str:
    if activity.status == "driving" and activity.start_at < when < activity.end_at:
        return f"En route: {_label(activity.start_location)} → {_label(activity.end_location)}"
    return _label(activity.end_location if when == activity.end_at else activity.start_location)


def _distance_at(activity: Activity, seconds: float) -> float:
    """Display interpolation only; never used to establish legal driving reachability."""
    duration = (instant(activity.end_at) - instant(activity.start_at)).total_seconds()
    if seconds <= 0:
        return 0.0
    if seconds >= duration:
        return activity.distance_meters
    if not activity.progress:
        return activity.distance_meters * seconds / duration
    index = bisect_right([point.seconds for point in activity.progress], seconds)
    if index == len(activity.progress):
        return activity.distance_meters
    left, right = activity.progress[index - 1], activity.progress[index]
    ratio = (seconds - left.seconds) / (right.seconds - left.seconds)
    return min(right.meters, max(left.meters, left.meters + ratio * (right.meters - left.meters)))


def _append_segment(day: dict, activity_id: str, status: str, start: int, end: int,
                    purpose: str, location: str, *, assumed: bool) -> None:
    day["segments"].append({
        "activity_id": activity_id, "status": status,
        "start_second": start, "end_second": end, "purpose": purpose,
        "location": location, "assumed": assumed,
    })
    day["totals"][status] += end - start
    if not assumed:
        day["remarks"].append({
            "time": f"{start // HOUR:02d}:{start % HOUR // 60:02d}:{start % 60:02d}",
            "location": location, "purpose": purpose, "status": status,
        })


def build_logs(activities: list[Activity], initial_cycle_seconds: int) -> list[dict]:
    validate_timeline(activities, initial_cycle_seconds)
    if not activities:
        return []

    state = HOSState(initial_cycle_seconds)
    days: dict[str, dict] = {}
    distances: dict[str, list[float]] = {}
    ids = {activity.id for activity in activities}
    padding_prefix = "assumed"
    while f"{padding_prefix}-before" in ids or f"{padding_prefix}-after" in ids:
        padding_prefix = f"_{padding_prefix}"

    for activity in activities:
        start = activity.start_at.astimezone(TERMINAL_TZ)
        finish = activity.end_at.astimezone(TERMINAL_TZ)
        cursor = start
        allocated = 0.0
        while cursor < finish:
            midnight = datetime.combine(cursor.date(), time(), TERMINAL_TZ)
            next_midnight = midnight + timedelta(days=1)
            end = min(finish, next_midnight)
            date = cursor.date().isoformat()
            if date not in days:
                days[date] = {
                    "date": date, "from_label": _location_at(activity, cursor),
                    "to_label": "", "distance_meters": 0.0, "segments": [],
                    "totals": dict.fromkeys(_STATUSES, 0), "remarks": [],
                    "cycle_used_hours": 0.0, "cycle_remaining_hours": 0.0,
                }
                distances[date] = []
            day = days[date]
            start_second = int((cursor - midnight).total_seconds())
            end_second = int((end - midnight).total_seconds())
            if not day["segments"] and start_second:
                _append_segment(day, f"{padding_prefix}-before", "off_duty", 0, start_second,
                                "break", _location_at(activity, cursor), assumed=True)
            _append_segment(day, activity.id, activity.status, start_second, end_second,
                            activity.purpose, _location_at(activity, cursor), assumed=False)
            day["to_label"] = _location_at(activity, end)

            cumulative = _distance_at(activity, (end - start).total_seconds()) if activity.status == "driving" else 0.0
            distance = cumulative - allocated
            allocated = cumulative
            distances[date].append(distance)
            # Padding is display-only: it cannot establish an unobserved cycle restart.
            state.apply(replace(activity, start_at=cursor, end_at=end,
                                distance_meters=distance, progress=()))
            day["cycle_used_hours"] = state.cycle_seconds / HOUR
            day["cycle_remaining_hours"] = max(0, CYCLE_SECONDS - state.cycle_seconds) / HOUR
            cursor = end

    result = list(days.values())
    last_day = result[-1]
    last_second = last_day["segments"][-1]["end_second"]
    if last_second < 86400:
        _append_segment(last_day, f"{padding_prefix}-after", "off_duty", last_second, 86400,
                        "break", _label(activities[-1].end_location), assumed=True)
    for day in result:
        day["distance_meters"] = fsum(distances[day["date"]])
    driving_days = [day for day in result if day["distance_meters"] > 0]
    if driving_days:
        # Assign the floating-point remainder once, rather than rounding each midnight slice.
        total = fsum(activity.distance_meters for activity in activities)
        driving_days[-1]["distance_meters"] = max(
            0.0, total - fsum(day["distance_meters"] for day in driving_days[:-1]),
        )
    return result
