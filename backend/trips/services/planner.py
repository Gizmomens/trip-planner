from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from uuid import uuid4

from trips.domain.assumptions import ASSUMPTIONS, FUEL_RANGE_METERS, TIME_BASIS
from trips.domain.errors import PlanningError
from trips.domain.hos import HOSState
from trips.domain.logs import build_logs
from trips.domain.models import Activity, Location, Route
from trips.domain.validation import validate_timeline
from trips.providers.tomtom import TomTom
from trips.services.budget import Budget

HOUR = 3600
_CANDIDATE_FAILURES = {"no_route", "unsupported_route", "unsupported_region", "no_facility"}


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(radians, (*a, *b))
    value = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 6_371_000 * 2 * asin(min(1, sqrt(value)))


def search_point(route: Route, seconds: int, fuel_meters: float, fraction: float) -> tuple[float, float]:
    distance = route.meters
    for left, right in zip(route.progress, route.progress[1:]):
        if seconds <= right.seconds:
            ratio = max(0, min(1, (seconds - left.seconds) / max(1, right.seconds - left.seconds)))
            distance = left.meters + ratio * (right.meters - left.meters)
            break
    # Geometry is used only to place search windows; actual routed legs prove reachability.
    fraction = min(distance, fuel_meters, route.meters) / route.meters * fraction
    lengths = [haversine(a, b) for a, b in zip(route.geometry, route.geometry[1:])]
    target = sum(lengths) * fraction
    cumulative = 0.0
    for index, length in enumerate(lengths):
        if cumulative + length >= target:
            a, b = route.geometry[index], route.geometry[index + 1]
            ratio = (target - cumulative) / length if length else 0
            return a[0] + ratio * (b[0] - a[0]), a[1] + ratio * (b[1] - a[1])
        cumulative += length
    return route.geometry[-1]


@dataclass
class Path:
    current: Location
    now: datetime
    state: HOSState
    fuel_meters: float
    activities: list[Activity]
    routes: list[Route]
    facilities: int = 0

    def fork(self) -> "Path":
        # Completed route/activity payloads are read-only across search branches.
        return replace(self, state=deepcopy(self.state), activities=self.activities.copy(), routes=self.routes.copy())

    def stop(self, purpose: str, seconds: int, *, working: bool = False):
        status = "on_duty" if working else "sleeper" if purpose in {"daily_rest", "cycle_restart"} else "off_duty"
        activity = Activity(
            f"a{len(self.activities) + 1}", status,
            purpose, self.now, self.now + timedelta(seconds=seconds), self.current, self.current,
        )
        self.state.apply(activity)
        self.activities.append(activity)
        self.now = activity.end_at
        if purpose == "fuel":
            self.fuel_meters = 0

    def drive(self, route: Route):
        if route.seconds == 0:
            self.current = route.destination
            return
        activity = Activity(
            f"a{len(self.activities) + 1}", "driving", "driving", self.now,
            self.now + timedelta(seconds=route.seconds), self.current, route.destination,
            route.meters, tuple(route.progress),
        )
        self.state.apply(activity)
        self.activities.append(activity)
        self.routes.append(route)
        self.current = route.destination
        self.now = activity.end_at
        self.fuel_meters += route.meters


class Planner:
    def __init__(self, provider: TomTom, budget: Budget):
        self.provider = provider
        self.budget = budget
        self.departure: datetime | None = None

    def check(self, path: Path):
        self.budget.check()
        if path.facilities > self.budget.limits.facilities:
            raise PlanningError("facility_limit", "The plan needs more facility visits than the configured limit.")
        if self.departure and (path.now - timedelta(microseconds=1)).date() >= self.departure.date() + timedelta(days=self.budget.limits.days):
            raise PlanningError("day_limit", "The plan exceeds the supported number of calendar days.")

    def _advance(self, path: Path, target: Location, visited: frozenset[str]) -> Path:
        self.check(path)
        direct = self.provider.route(path.current, target)
        allowance = path.state.allowance(path.now)
        fuel_remaining = max(0, FUEL_RANGE_METERS - path.fuel_meters)
        if direct.seconds <= allowance and direct.meters <= fuel_remaining:
            result = path.fork()
            result.drive(direct)
            self.check(result)
            return result

        # Exhausted clocks must reset at the current valid stopping place, before any driving.
        if allowance <= 0:
            for purpose, duration in (("break", 1800), ("daily_rest", 10 * HOUR), ("cycle_restart", 34 * HOUR)):
                refreshed = path.fork()
                refreshed.stop(purpose, duration)
                if refreshed.state.allowance(refreshed.now) > allowance:
                    return self._advance(refreshed, target, visited)
            raise PlanningError("no_facility", "No driving capacity is available from this stop.")

        attempted: set[str] = set(visited)
        fuel_binding = fuel_remaining < direct.meters and self._fuel_time(direct, fuel_remaining) <= allowance
        if path.facilities < self.budget.limits.facilities and fuel_remaining > 0:
            for fraction in (0.9, 0.65, 0.4, 0.15):
                lon, lat = search_point(direct, allowance, fuel_remaining, fraction)
                candidates = self.provider.facilities(lon, lat, fuel_only=fuel_binding)
                candidates.sort(key=lambda loc: (haversine((lon, lat), (loc.lon, loc.lat)), loc.id))
                for facility in candidates[:4]:
                    if facility.id in attempted or facility.id == path.current.id:
                        continue
                    attempted.add(facility.id)
                    try:
                        inbound = self.provider.route(path.current, facility)
                        if not 0 < inbound.seconds <= allowance or not 0 < inbound.meters <= fuel_remaining:
                            continue
                        onward = self.provider.route(facility, target)
                        if onward.meters >= direct.meters:
                            continue
                        candidate = path.fork()
                        candidate.drive(inbound)
                        candidate.facilities += 1
                        if facility.kind == "fuel_station" and (fuel_binding or direct.meters > fuel_remaining):
                            candidate.stop("fuel", 1800, working=True)
                        if not fuel_binding:
                            self._rest_for_binding_limit(path, candidate)
                        return self._advance(candidate, target, visited | {facility.id})
                    except PlanningError as error:
                        if error.code not in _CANDIDATE_FAILURES:
                            raise

        # A partial initial shift/cycle can strand a greedy search. Rest here and search farther.
        for purpose, duration in (("break", 1800), ("daily_rest", 10 * HOUR), ("cycle_restart", 34 * HOUR)):
            refreshed = path.fork()
            refreshed.stop(purpose, duration)
            if refreshed.state.allowance(refreshed.now) > allowance:
                try:
                    return self._advance(refreshed, target, visited)
                except PlanningError as error:
                    if error.code not in _CANDIDATE_FAILURES:
                        raise
        if path.facilities >= self.budget.limits.facilities:
            raise PlanningError("facility_limit", "The facility-visit limit was reached.")
        raise PlanningError("no_facility", "No reachable real fuel/rest facility was found within the planning limits. Try different locations.")

    @staticmethod
    def _fuel_time(route: Route, meters: float) -> float:
        for left, right in zip(route.progress, route.progress[1:]):
            if meters <= right.meters:
                ratio = max(0, min(1, (meters - left.meters) / max(1, right.meters - left.meters)))
                return left.seconds + ratio * (right.seconds - left.seconds)
        return route.seconds

    @staticmethod
    def _rest_for_binding_limit(before: Path, after: Path):
        available = before.state.allowance(before.now)
        # Probe which reset releases the limiting clock; this also handles tied constraints.
        for purpose, duration in (("break", 1800), ("daily_rest", 10 * HOUR), ("cycle_restart", 34 * HOUR)):
            probe = before.fork()
            probe.stop(purpose, duration)
            if probe.state.allowance(probe.now) > available or available == 8 * HOUR:
                if purpose == "break" and after.activities[-1].purpose == "fuel":
                    return
                after.stop(purpose, duration)
                return
        after.stop("cycle_restart", 34 * HOUR)

    def plan(self, locations: list[Location], departure: datetime, initial_cycle_seconds: int) -> dict:
        self.departure = departure
        path = Path(locations[0], departure, HOSState(initial_cycle_seconds), 0, [], [])
        for target, purpose in zip(locations[1:], ("pickup", "dropoff")):
            path = self._advance(path, target, frozenset())
            path.stop(purpose, HOUR, working=True)
            self.check(path)
        verified = validate_timeline(path.activities, initial_cycle_seconds)
        self.budget.check()
        days = build_logs(path.activities, initial_cycle_seconds)
        self.budget.check()
        geometry: list[tuple[float, float]] = []
        instructions = []
        meters = 0.0
        driving = 0
        for route in path.routes:
            self.budget.check()
            geometry.extend(route.geometry if not geometry else route.geometry[1:] if geometry[-1] == route.geometry[0] else route.geometry)
            instructions.extend({**item, "distance_meters": item["distance_meters"] + meters, "travel_seconds": item["travel_seconds"] + driving} for item in route.instructions)
            meters += route.meters
            driving += route.seconds
        if not geometry:
            geometry = [(locations[0].lon, locations[0].lat)]
        stops = []
        for activity in path.activities:
            self.budget.check()
            if activity.status == "driving":
                continue
            if stops and stops[-1]["location"]["id"] == activity.start_location.id and stops[-1]["departure_at"] == activity.start_at.isoformat():
                stops[-1]["departure_at"] = activity.end_at.isoformat()
                stops[-1]["purposes"].append(activity.purpose)
                stops[-1]["activity_ids"].append(activity.id)
            else:
                stops.append({
                    "id": activity.id, "location": activity.start_location.to_dict(),
                    "arrival_at": activity.start_at.isoformat(), "departure_at": activity.end_at.isoformat(),
                    "purposes": [activity.purpose], "activity_ids": [activity.id],
                })
        warnings = ["Projected plan using conservative cycle accounting; not a certified ELD record.",
                    "Facility availability and permission to stop are assumed, not checked.",
                    "Daily mileage is allocated using estimated route progress, not vehicle telemetry."]
        if any("Locality not provided" in activity.start_location.address for activity in path.activities):
            warnings.append("A mapped facility has incomplete locality information; its reported address is shown without inventing a city.")
        result = {
            "id": str(uuid4()), "departure_at": departure.isoformat(), "arrival_at": path.now.isoformat(),
            "time_basis": TIME_BASIS, "locations": [loc.to_dict() for loc in locations],
            "activities": [activity.to_dict() for activity in path.activities], "stops": stops,
            "route": {"geometry": geometry, "instructions": instructions},
            "summary": {
                "distance_meters": meters, "driving_seconds": driving,
                "on_duty_seconds": sum(a.seconds for a in path.activities if a.status == "on_duty"),
                "off_duty_seconds": sum(a.seconds for a in path.activities if a.status in {"off_duty", "sleeper"}),
                "elapsed_seconds": int((path.now - departure).total_seconds()),
                "days": len(days), "cycle_remaining_hours": max(0, 70 - verified.cycle_seconds / HOUR),
            },
            "days": days, "assumptions": ASSUMPTIONS, "warnings": warnings,
        }
        self.budget.check()
        return result
