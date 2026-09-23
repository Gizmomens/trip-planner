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


ASSUMPTION_IDS = ("A08", "A09", "A12", "A11", "A20", "A21", "A17", "A26")
