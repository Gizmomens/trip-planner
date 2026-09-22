from dataclasses import dataclass
from datetime import timedelta, timezone

TERMINAL_TZ = timezone(timedelta(hours=-6))
TIME_BASIS = "UTC-06:00 (fixed; no daylight-saving adjustment)"
ASSUMPTIONS_VERSION = "2"
MILE_METERS = 1609.344
FUEL_RANGE_METERS = 1000 * MILE_METERS


@dataclass(frozen=True)
class Limits:
    days: int = 30
    facilities: int = 100
    provider_requests: int = 100
    processing_seconds: int = 120


ASSUMPTIONS = [
    {"id": "A08", "title": "Fixed planning clock", "detail": "08:00 departure on the displayed date; all logs use fixed UTC-06:00, not the browser timezone."},
    {"id": "A09", "title": "Fresh driving shift", "detail": "At least 10 hours off before departure. Current cycle usage still applies."},
    {"id": "A12", "title": "Conservative 70-hour cycle", "detail": "No historical daily recapture is inferred. A 34-hour restart restores cycle capacity when needed."},
    {"id": "A11", "title": "Full sleeper-berth rests", "detail": "Full 10-hour daily rests and 34-hour restarts use the sleeper-berth row. Ordinary 30-minute breaks remain off duty; no split-sleeper optimization."},
    {"id": "A20", "title": "Real facilities, assumed availability", "detail": "Mapped fuel/rest facilities are assumed usable at any time, for any required stay. Parking and opening hours are not checked."},
    {"id": "A21", "title": "Fuel and loading", "detail": "Start fully fueled. Fuel every 1,000 routed miles or earlier: 30 minutes on duty. Pickup and drop-off: one hour each."},
    {"id": "A17", "title": "Estimated truck route", "detail": "Generic truck routing without vehicle dimensions or live traffic replanning. Not guaranteed vehicle-specific navigation."},
    {"id": "A26", "title": "Projected sheets only", "detail": "Outside-trip time is assumed off duty. Missing identity and shipping fields are not provided. These are not certified ELD records."},
]
