import logging
from dataclasses import asdict
from datetime import datetime
from functools import wraps

from django.conf import settings
from django.core import signing
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie

from trips.api.middleware import error_response
from trips.api.validation import signed_location, trip_input
from trips.domain.assumptions import ASSUMPTION_IDS, ASSUMPTIONS_VERSION, Limits, TERMINAL_TZ, TIME_BASIS
from trips.domain.errors import PlanningError
from trips.providers.tomtom import TomTom
from trips.services.budget import Budget
from trips.services.planner import Planner

logger = logging.getLogger("trips.api")


def endpoint(method):
    def decorate(view):
        @wraps(view)
        def wrapped(request):
            if request.method != method:
                response = error_response("method_not_allowed", f"Use {method} for this endpoint.", 405, request.request_id)
                response["Allow"] = method
                return response
            try:
                return view(request)
            except PlanningError as error:
                logger.warning("planning_error id=%s code=%s", request.request_id, error.code)
                response = error_response(error.code, error.message, error.status, request.request_id, error.fields)
                if error.retry_after is not None:
                    response["Retry-After"] = str(error.retry_after)
                return response
        return wrapped
    return decorate


def limits():
    return Limits(**getattr(settings, "PLANNING_LIMITS", {}))


def budgeted_response(data: dict, budget: Budget) -> JsonResponse:
    budget.check()
    response = JsonResponse(data)
    budget.check()
    return response


@endpoint("GET")
@ensure_csrf_cookie
def bootstrap(request):
    departure = datetime.now(TERMINAL_TZ).replace(hour=8, minute=0, second=0, microsecond=0).isoformat()
    return JsonResponse({
        "csrf_token": get_token(request),
        "planning_token": signing.dumps({"departure_at": departure, "assumptions_version": ASSUMPTIONS_VERSION}, salt="spotter.planning"),
        "departure_at": departure, "time_basis": TIME_BASIS,
        "map_key": settings.TOMTOM_MAP_KEY, "provider_ready": bool(settings.TOMTOM_API_KEY),
        "assumptions_version": ASSUMPTIONS_VERSION,
        "assumption_ids": ASSUMPTION_IDS,
        "limits": asdict(limits()),
    })


@endpoint("GET")
def locations(request):
    query = request.GET.get("q", "").strip()
    if not 3 <= len(query) <= 200 or any(ord(char) < 32 for char in query):
        raise PlanningError("invalid_query", "Enter a location between 3 and 200 characters.", 400)
    budget = Budget(Limits(provider_requests=2, processing_seconds=20))
    with TomTom(settings.TOMTOM_API_KEY, budget) as provider:
        result = {"locations": [signed_location(location) for location in provider.lookup(query)]}
    return budgeted_response(result, budget)


@endpoint("POST")
def trips(request):
    points, departure, cycle = trip_input(request)
    budget = Budget(limits())
    with TomTom(settings.TOMTOM_API_KEY, budget) as provider:
        result = Planner(provider, budget).plan(points, departure, cycle)
    return budgeted_response(result, budget)


def csrf_failure(request, reason=""):
    return error_response("csrf_failed", "The page's security token is missing or expired. Reload the page.", 403,
                          getattr(request, "request_id", "unavailable"))


def not_found(request, exception=None):
    return error_response("not_found", "This API endpoint does not exist.", 404, getattr(request, "request_id", "unavailable"))


def server_error(request):
    logger.error("unexpected_failure id=%s", getattr(request, "request_id", "unavailable"))
    return error_response("internal_error", "An unexpected error interrupted planning. Try again.", 500,
                          getattr(request, "request_id", "unavailable"))
