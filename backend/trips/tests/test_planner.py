import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from trips.domain.assumptions import FUEL_RANGE_METERS, Limits, MILE_METERS, TERMINAL_TZ
from trips.domain.errors import PlanningError
from trips.domain.hos import HOSState
from trips.domain.models import Activity, Location, Route, RoutePoint
from trips.services.budget import Budget
from trips.services.planner import Path, Planner, search_point


def location(miles: float, kind: str = "location") -> Location:
    return Location(str(miles), f"Place {miles}", f"Place {miles}, TX", 35, -120 + miles / 100, kind)


class RoadProvider:
    """Authored linear-road fixture, not a fallback used by the application."""

    def __init__(self, *, stops=True, detour=0, unavailable=()):
        self.stops = stops
        self.detour = detour
        self.unavailable = unavailable
        self.visited = []

    def route(self, origin, destination):
        miles = abs(destination.lon - origin.lon) * 100
        if destination.kind != "location":
            miles += self.detour
        meters = miles * MILE_METERS
        seconds = round(miles * 60)
        self.visited.append((origin.id, destination.id))
        return Route(origin, destination, meters, seconds, [(origin.lon, origin.lat), (destination.lon, destination.lat)],
                     [{"text": "Continue", "distance_meters": 0, "travel_seconds": 0, "point": (origin.lon, origin.lat)}] if miles else [],
                     [RoutePoint(origin.lon, origin.lat, 0, 0), RoutePoint(destination.lon, destination.lat, seconds, meters)])

    def facilities(self, lon, lat, *, fuel_only=False):
        if not self.stops:
            return []
        mile = (lon + 120) * 100
        return [location(round(mile / 20) * 20 - n * 20, "fuel_station" if fuel_only else "rest_area")
                for n in range(3) if round(mile / 20) * 20 - n * 20 not in self.unavailable]


class PlannerTests(unittest.TestCase):
    def plan(self, miles, *, pickup=0, cycle=0, provider=None, limits=None):
        provider = provider or RoadProvider()
        budget = Budget(limits or Limits())
        return Planner(provider, budget).plan(
            [location(0), location(pickup), location(miles)],
            datetime(2026, 9, 21, 8, tzinfo=TERMINAL_TZ), round(cycle * 3600),
        )

    def test_short_trip_and_pickup_dropoff(self):
        result = self.plan(100, pickup=20)
        self.assertEqual([a["purpose"] for a in result["activities"]], ["driving", "pickup", "driving", "dropoff"])
        self.assertAlmostEqual(result["summary"]["distance_meters"], 100 * MILE_METERS)
        self.assertEqual(result["summary"]["on_duty_seconds"], 7200)

    def test_coincident_locations_still_have_both_work_stops(self):
        result = self.plan(0)
        self.assertEqual([a["purpose"] for a in result["activities"]], ["pickup", "dropoff"])
        self.assertEqual(result["summary"]["distance_meters"], 0)

    def test_long_trip_contains_actual_fuel_and_rests(self):
        result = self.plan(2400)
        purposes = {a["purpose"] for a in result["activities"]}
        self.assertTrue({"fuel", "daily_rest", "break"} <= purposes)
        for activity in result["activities"]:
            if activity["purpose"] == "daily_rest":
                self.assertEqual(activity["status"], "sleeper")
            elif activity["purpose"] == "break":
                self.assertEqual(activity["status"], "off_duty")
            elif activity["purpose"] == "fuel":
                self.assertEqual(activity["status"], "on_duty")
        self.assertGreater(len(result["days"]), 1)
        self.assertGreater(sum(day["totals"]["sleeper"] for day in result["days"]), 0)
        for stop in result["stops"]:
            if "fuel" in stop["purposes"]:
                self.assertEqual(stop["location"]["kind"], "fuel_station")
        self.assertAlmostEqual(sum(day["distance_meters"] for day in result["days"]), result["summary"]["distance_meters"])
        self.assertTrue(all(sum(day["totals"].values()) == 86400 for day in result["days"]))

    def test_successful_plan_does_not_request_the_same_route_twice(self):
        provider = RoadProvider()
        self.plan(1200, provider=provider)
        self.assertEqual(len(provider.visited), len(set(provider.visited)), provider.visited)

    def test_initial_cycle_restart_and_no_extra_final_rest(self):
        result = self.plan(60, cycle=70)
        self.assertEqual(result["activities"][0]["purpose"], "pickup")
        self.assertEqual(result["activities"][1]["purpose"], "cycle_restart")
        self.assertEqual(result["activities"][1]["status"], "sleeper")
        nearly_full = self.plan(60, cycle=68)
        self.assertEqual([a["purpose"] for a in nearly_full["activities"]], ["pickup", "driving", "dropoff"])

    def test_no_facility_is_explicit_failure(self):
        with self.assertRaises(PlanningError) as caught:
            self.plan(1200, provider=RoadProvider(stops=False))
        self.assertEqual(caught.exception.code, "no_facility")

    def test_detour_and_caps_are_enforced(self):
        with self.assertRaises(PlanningError):
            self.plan(1200, provider=RoadProvider(detour=1200))
        with self.assertRaises(PlanningError) as caught:
            self.plan(1200, limits=Limits(facilities=0))
        self.assertEqual(caught.exception.code, "facility_limit")
        with self.assertRaises(PlanningError) as caught:
            self.plan(60, cycle=70, limits=Limits(days=1))
        self.assertEqual(caught.exception.code, "day_limit")

    def test_partial_cycle_can_rest_before_leaving_origin(self):
        result = self.plan(100, cycle=68.9, provider=RoadProvider(stops=False))
        self.assertIn("cycle_restart", [a["purpose"] for a in result["activities"]])

    def test_search_point_is_not_an_actual_stop(self):
        route = RoadProvider().route(location(0), location(1000))
        lon, lat = search_point(route, 8 * 3600, FUEL_RANGE_METERS, 0.9)
        self.assertAlmostEqual((lon + 120) * 100, 432)
        self.assertEqual(lat, 35)

    def test_final_activity_serialization_obeys_deadline(self):
        now = [0]
        budget = Budget(Limits(), clock=lambda: now[0])
        original = Activity.to_dict
        def serialize_late(activity):
            result = original(activity)
            now[0] = 121
            return result
        with patch.object(Activity, "to_dict", serialize_late), self.assertRaises(PlanningError) as caught:
            Planner(RoadProvider(), budget).plan(
                [location(0), location(20), location(100)],
                datetime(2026, 9, 21, 8, tzinfo=TERMINAL_TZ), 0,
            )
        self.assertEqual(caught.exception.code, "deadline_exceeded")

    def test_path_fork_isolates_state_and_appends_but_shares_history(self):
        departure = datetime(2026, 9, 21, 8, tzinfo=TERMINAL_TZ)
        provider = RoadProvider()
        parent = Path(location(0), departure, HOSState(0), 0, [], [])
        route = provider.route(location(0), location(60))
        parent.drive(route)
        child = parent.fork()
        self.assertIsNot(child.state, parent.state)
        self.assertIsNot(child.activities, parent.activities)
        self.assertIsNot(child.routes, parent.routes)
        self.assertIs(child.activities[0], parent.activities[0])
        self.assertIs(child.routes[0], route)
        self.assertIs(child.routes[0].geometry, route.geometry)
        self.assertIs(child.routes[0].instructions, route.instructions)
        self.assertIs(child.routes[0].progress, route.progress)
        child.stop("break", 1800)
        child.drive(provider.route(location(60), location(120)))
        child.facilities += 1
        self.assertEqual(parent.current, location(60))
        self.assertEqual(parent.now, departure + timedelta(hours=1))
        self.assertEqual(parent.state.driving_seconds, 3600)
        self.assertEqual(parent.state.cycle_seconds, 3600)
        self.assertAlmostEqual(parent.fuel_meters, 60 * MILE_METERS)
        self.assertEqual(parent.facilities, 0)
        self.assertEqual((len(parent.activities), len(parent.routes)), (1, 1))
        self.assertEqual((len(child.activities), len(child.routes)), (3, 2))
        parent.stop("pickup", 3600, working=True)
        self.assertEqual(child.state.cycle_seconds, 7200)
        self.assertEqual(child.activities[-1].purpose, "driving")

    def test_planning_does_not_deepcopy_completed_route_payloads(self):
        class CopyGuard(dict):
            def __deepcopy__(self, memo):
                raise AssertionError("Completed route payload was deep-copied")

        class GuardedProvider(RoadProvider):
            def route(self, origin, destination):
                route = super().route(origin, destination)
                route.instructions = [CopyGuard(item) for item in route.instructions]
                return route

        result = self.plan(1200, pickup=20, provider=GuardedProvider())
        self.assertGreater(len(result["days"]), 1)
        self.assertIn("fuel", {activity["purpose"] for activity in result["activities"]})
        self.assertAlmostEqual(result["summary"]["distance_meters"], 1200 * MILE_METERS)


if __name__ == "__main__":
    unittest.main()
