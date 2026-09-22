import json
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_CEILING

from django.core import signing
from django.core.exceptions import RequestDataTooBig

from trips.domain.assumptions import ASSUMPTIONS_VERSION, TERMINAL_TZ
from trips.domain.errors import PlanningError
from trips.domain.models import Location
from trips.providers.tomtom import coordinates


def signed_location(location: Location) -> dict:
    data = location.to_dict()
    return {**data, "token": signing.dumps(data, salt="spotter.location", compress=True)}


def resolve_location(token, field):
    if not isinstance(token, str) or len(token) > 4096:
        raise PlanningError("invalid_input", "Select a location from the search results.", 400, {field: "Select a location."})
    try:
        data = signing.loads(token, salt="spotter.location", max_age=86400)
        location = Location(**data)
        coordinates(location.lon, location.lat)
        return location
    except (signing.BadSignature, TypeError, ValueError):
        raise PlanningError("invalid_location", "A selected location expired or is invalid. Search for it again.", 400, {field: "Search and select this location again."}) from None


def invalid_constant(_):
    raise ValueError("Non-finite JSON number")


def trip_input(request):
    if request.content_type != "application/json":
        raise PlanningError("invalid_content_type", "Send a JSON request.", 415)
    try:
        body = json.loads(request.body, parse_float=Decimal, parse_constant=invalid_constant)
    except RequestDataTooBig:
        raise PlanningError("body_too_large", "The request body is too large.", 413) from None
    except (ValueError, UnicodeDecodeError):
        raise PlanningError("invalid_json", "The request is not valid JSON.", 400) from None
    expected = {"current", "pickup", "dropoff", "cycle_used_hours", "planning_token"}
    if not isinstance(body, dict) or set(body) != expected:
        raise PlanningError("invalid_input", "Provide the four trip inputs and the displayed planning context.", 400)
    hours = body["cycle_used_hours"]
    try:
        if isinstance(hours, bool) or not isinstance(hours, (int, Decimal)):
            raise InvalidOperation
        hours = Decimal(hours)
        if not hours.is_finite() or not 0 <= hours <= 192:
            raise InvalidOperation
        cycle_seconds = int((hours * 3600).to_integral_value(rounding=ROUND_CEILING))
    except (InvalidOperation, ValueError, OverflowError):
        raise PlanningError("invalid_input", "Cycle usage must be between 0 and 192 hours (eight full days).", 400,
                            {"cycle_used_hours": "Enter a finite, non-negative value no greater than 192."}) from None
    token = body["planning_token"]
    try:
        if not isinstance(token, str) or len(token) > 1024:
            raise ValueError
        context = signing.loads(token, salt="spotter.planning", max_age=86400)
        departure = datetime.fromisoformat(context["departure_at"])
        if context["assumptions_version"] != ASSUMPTIONS_VERSION or departure.tzinfo != TERMINAL_TZ or departure.hour != 8:
            raise ValueError
    except (signing.BadSignature, ValueError, KeyError, TypeError):
        raise PlanningError("expired_context", "The displayed planning context expired. Reload the page and try again.", 400) from None
    return [resolve_location(body[key], key) for key in ("current", "pickup", "dropoff")], departure, cycle_seconds
