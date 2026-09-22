import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from math import fsum

from trips.domain.assumptions import TERMINAL_TZ
from trips.domain.errors import PlanningError
from trips.domain.logs import build_logs
from trips.domain.models import Activity, Location, RoutePoint

HOUR = 3600
ORIGIN = Location("origin", "Origin", "Origin, TX", 30, -100)
DESTINATION = Location("destination", "Destination", "Destination, TX", 31, -99)
START = datetime(2026, 9, 21, 8, tzinfo=TERMINAL_TZ)


class Timeline:
    def __init__(self, start=START):
        self.now = start
        self.location = ORIGIN
        self.activities = []

    def add(self, status, seconds, purpose=None, meters=0, destination=None, progress=()):
        purpose = purpose or {"driving": "driving", "on_duty": "pickup",
                              "off_duty": "daily_rest", "sleeper": "daily_rest"}[status]
        destination = destination or self.location
        activity = Activity(
            f"a{len(self.activities) + 1}", status, purpose, self.now,
            self.now + timedelta(seconds=seconds), self.location, destination, meters, progress,
        )
        self.activities.append(activity)
        self.now = activity.end_at
        self.location = destination
        return activity


class DailyLogTests(unittest.TestCase):
    def assert_complete_days(self, days):
        for day in days:
            self.assertEqual(set(day["totals"]), {"off_duty", "sleeper", "driving", "on_duty"})
            self.assertEqual(sum(day["totals"].values()), 86400)
            self.assertEqual(day["segments"][0]["start_second"], 0)
            self.assertEqual(day["segments"][-1]["end_second"], 86400)
            for segment in day["segments"]:
                self.assertIsInstance(segment["start_second"], int)
                self.assertIsInstance(segment["end_second"], int)
                self.assertLess(segment["start_second"], segment["end_second"])
            for left, right in zip(day["segments"], day["segments"][1:]):
                self.assertEqual(left["end_second"], right["start_second"])
            for status, seconds in day["totals"].items():
                self.assertEqual(seconds, sum(segment["end_second"] - segment["start_second"]
                                              for segment in day["segments"] if segment["status"] == status))

    def test_short_trip_has_honest_padding_labels_totals_and_remarks(self):
        timeline = Timeline()
        timeline.add("on_duty", HOUR)
        timeline.add("driving", 2 * HOUR, meters=12345.67, destination=DESTINATION)
        timeline.add("on_duty", HOUR, "dropoff")
        days = build_logs(timeline.activities, 20 * HOUR)
        self.assertEqual(len(days), 1)
        self.assert_complete_days(days)
        day = days[0]
        self.assertEqual(day["date"], "2026-09-21")
        self.assertEqual(day["from_label"], ORIGIN.address)
        self.assertEqual(day["to_label"], DESTINATION.address)
        self.assertEqual(day["totals"], {"off_duty": 20 * HOUR, "sleeper": 0,
                                         "driving": 2 * HOUR, "on_duty": 2 * HOUR})
        self.assertEqual(day["distance_meters"], 12345.67)
        self.assertEqual(day["cycle_used_hours"], 24)
        self.assertEqual(day["cycle_remaining_hours"], 46)
        self.assertEqual([segment["assumed"] for segment in day["segments"]], [True, False, False, False, True])
        self.assertEqual([remark["time"] for remark in day["remarks"]], ["08:00:00", "09:00:00", "11:00:00"])
        self.assertEqual(day["remarks"][-1]["location"], DESTINATION.address)
        self.assertNotIn("driver_name", day)
        self.assertNotIn("recapture", day)

    def test_empty_timeline_has_no_invented_day(self):
        self.assertEqual(build_logs([], 70 * HOUR), [])

    def test_midnight_finish_has_no_phantom_extra_day(self):
        timeline = Timeline(START.replace(hour=23))
        timeline.add("driving", HOUR, meters=42)
        days = build_logs(timeline.activities, 0)
        self.assertEqual(len(days), 1)
        self.assertEqual(days[0]["date"], "2026-09-21")
        self.assertEqual(days[0]["segments"][-1]["end_second"], 86400)
        self.assertFalse(days[0]["segments"][-1]["assumed"])
        self.assert_complete_days(days)

    def test_last_activity_starting_at_midnight_does_create_occupied_day(self):
        timeline = Timeline(START.replace(hour=23))
        timeline.add("driving", HOUR)
        timeline.add("on_duty", 1, "dropoff")
        days = build_logs(timeline.activities, 0)
        self.assertEqual(len(days), 2)
        self.assertEqual(days[1]["segments"][0]["end_second"], 1)
        self.assert_complete_days(days)

    def test_time_basis_is_fixed_minus_six_not_input_timezone(self):
        timeline = Timeline(datetime(2026, 9, 22, 5, 30, tzinfo=timezone.utc))
        timeline.add("driving", HOUR, meters=100)
        days = build_logs(timeline.activities, 0)
        self.assertEqual([day["date"] for day in days], ["2026-09-21", "2026-09-22"])
        self.assertEqual(days[0]["remarks"][0]["time"], "23:30:00")
        self.assertEqual(days[1]["remarks"][0]["time"], "00:00:00")
        self.assertEqual([day["distance_meters"] for day in days], [50, 50])
        self.assert_complete_days(days)

    def test_full_rest_day_is_included_and_cycle_reset_occurs_on_correct_day(self):
        timeline = Timeline(START.replace(hour=22))
        rest = timeline.add("off_duty", 34 * HOUR, "cycle_restart")
        timeline.add("driving", HOUR, meters=100)
        days = build_logs(timeline.activities, 70 * HOUR)
        self.assertEqual([day["date"] for day in days], ["2026-09-21", "2026-09-22", "2026-09-23"])
        self.assertEqual([day["cycle_used_hours"] for day in days], [70, 70, 1])
        self.assertEqual([day["cycle_remaining_hours"] for day in days], [0, 0, 69])
        self.assertEqual(days[1]["totals"]["off_duty"], 86400)
        self.assertEqual(days[1]["distance_meters"], 0)
        self.assertEqual(days[1]["segments"][0]["activity_id"], rest.id)
        self.assertFalse(days[1]["segments"][0]["assumed"])
        self.assert_complete_days(days)

    def test_padding_does_not_invent_prior_or_subsequent_cycle_restart(self):
        timeline = Timeline()
        timeline.add("off_duty", 30 * HOUR, "daily_rest")
        days = build_logs(timeline.activities, 70 * HOUR)
        self.assertEqual([day["cycle_used_hours"] for day in days], [70, 70])
        self.assertEqual([day["cycle_remaining_hours"] for day in days], [0, 0])
        self.assert_complete_days(days)

    def test_ten_hour_rest_does_not_restore_cycle_on_logs(self):
        timeline = Timeline()
        timeline.add("driving", 2 * HOUR)
        timeline.add("off_duty", 10 * HOUR)
        timeline.add("driving", HOUR)
        days = build_logs(timeline.activities, 60 * HOUR)
        self.assertEqual(days[-1]["cycle_used_hours"], 63)
        self.assertEqual(days[-1]["cycle_remaining_hours"], 7)

    def test_each_day_cycle_is_its_own_end_state_not_final_trip_state(self):
        timeline = Timeline(START.replace(hour=22))
        timeline.add("driving", 4 * HOUR, meters=400)
        days = build_logs(timeline.activities, 50 * HOUR)
        self.assertEqual([day["cycle_used_hours"] for day in days], [52, 54])
        self.assertEqual([day["cycle_remaining_hours"] for day in days], [18, 16])
        self.assertEqual([day["distance_meters"] for day in days], [200, 200])

    def test_on_duty_after_cycle_limit_is_displayed_without_negative_capacity(self):
        timeline = Timeline(START.replace(hour=23))
        timeline.add("on_duty", 2 * HOUR, "dropoff")
        days = build_logs(timeline.activities, 70 * HOUR)
        self.assertEqual([day["cycle_used_hours"] for day in days], [71, 72])
        self.assertEqual([day["cycle_remaining_hours"] for day in days], [0, 0])
        self.assert_complete_days(days)

    def test_stable_ids_and_truthful_in_route_labels_across_midnight(self):
        timeline = Timeline(START.replace(hour=23))
        drive = timeline.add("driving", 2 * HOUR, meters=200, destination=DESTINATION)
        days = build_logs(timeline.activities, 0)
        actual = [segment for day in days for segment in day["segments"] if not segment["assumed"]]
        self.assertEqual([segment["activity_id"] for segment in actual], [drive.id, drive.id])
        self.assertEqual(days[0]["from_label"], ORIGIN.address)
        self.assertEqual(days[1]["to_label"], DESTINATION.address)
        self.assertTrue(days[0]["to_label"].startswith("En route:"))
        self.assertEqual(days[0]["to_label"], days[1]["from_label"])
        self.assertTrue(days[1]["remarks"][0]["location"].startswith("En route:"))

    def test_fractional_provider_progress_controls_midnight_allocation(self):
        timeline = Timeline(START.replace(hour=23, minute=59, second=59))
        progress = tuple(RoutePoint(-100, 30, seconds, meters)
                         for seconds, meters in [(0, 0), (0.5, 5), (1.5, 15), (2.75, 20)])
        timeline.add("driving", 3, meters=20, progress=progress)
        days = build_logs(timeline.activities, 0)
        self.assertEqual([day["distance_meters"] for day in days], [10, 10])
        self.assertEqual([day["totals"]["driving"] for day in days], [1, 2])
        self.assert_complete_days(days)

    def test_equal_provider_timestamps_do_not_divide_by_zero_or_lose_mileage(self):
        timeline = Timeline(START.replace(hour=23, minute=59, second=59))
        progress = tuple(RoutePoint(-100, 30, seconds, meters)
                         for seconds, meters in [(0, 0), (1, 2), (1, 4), (2, 10)])
        timeline.add("driving", 2, meters=10, progress=progress)
        days = build_logs(timeline.activities, 0)
        self.assertEqual([day["distance_meters"] for day in days], [4, 6])

    def test_missing_progress_uses_display_ratio_and_preserves_remainder(self):
        timeline = Timeline(START.replace(hour=23, minute=59, second=59))
        timeline.add("driving", 3, meters=0.3)
        days = build_logs(timeline.activities, 0)
        self.assertAlmostEqual(days[0]["distance_meters"], 0.1)
        self.assertAlmostEqual(days[1]["distance_meters"], 0.2)
        self.assertEqual(fsum(day["distance_meters"] for day in days), 0.3)

    def test_many_fractional_drives_reconcile_across_days(self):
        timeline = Timeline(START.replace(hour=23, minute=59, second=59))
        for index in range(20):
            timeline.add("driving", 3, meters=0.1 + index / 1000)
            if index < 19:
                timeline.add("off_duty", 86400 - 3)
        days = build_logs(timeline.activities, 0)
        self.assertEqual(fsum(day["distance_meters"] for day in days),
                         fsum(activity.distance_meters for activity in timeline.activities))
        self.assert_complete_days(days)

    def test_sleeper_and_adjacent_rest_can_restart_across_days(self):
        timeline = Timeline()
        timeline.add("off_duty", 12 * HOUR)
        timeline.add("sleeper", 22 * HOUR)
        timeline.add("driving", HOUR)
        days = build_logs(timeline.activities, 70 * HOUR)
        self.assertEqual(sum(day["totals"]["sleeper"] for day in days), 22 * HOUR)
        self.assertEqual(days[-1]["cycle_used_hours"], 1)
        self.assert_complete_days(days)

    def test_fueling_split_at_midnight_is_valid_as_one_completed_activity(self):
        timeline = Timeline(START.replace(hour=23, minute=50))
        fuel = timeline.add("on_duty", 1800, "fuel")
        timeline.add("driving", HOUR, meters=100)
        days = build_logs(timeline.activities, 0)
        self.assertEqual([day["totals"]["on_duty"] for day in days], [600, 1200])
        self.assertEqual(days[0]["segments"][-1]["activity_id"], fuel.id)
        self.assertEqual(days[1]["segments"][0]["activity_id"], fuel.id)
        self.assert_complete_days(days)

    def test_location_falls_back_to_name_without_inventing_address(self):
        timeline = Timeline()
        timeline.location = replace(ORIGIN, address="", name="Actual rest area")
        timeline.add("off_duty", HOUR)
        day = build_logs(timeline.activities, 0)[0]
        self.assertEqual(day["from_label"], "Actual rest area")
        self.assertEqual(day["remarks"][0]["location"], "Actual rest area")

    def test_invalid_timeline_is_not_hidden_by_padding(self):
        timeline = Timeline()
        first = timeline.add("on_duty", HOUR)
        second = timeline.add("driving", HOUR)
        with self.assertRaises(PlanningError):
            build_logs([first, replace(second, start_at=second.start_at + timedelta(seconds=1))], 0)
        with self.assertRaises(PlanningError):
            build_logs([replace(first, distance_meters=1)], 0)

    def test_input_is_unchanged_and_repeated_output_is_deterministic(self):
        timeline = Timeline()
        timeline.add("driving", HOUR, meters=123)
        original = list(timeline.activities)
        first = build_logs(timeline.activities, 0)
        second = build_logs(timeline.activities, 0)
        self.assertEqual(first, second)
        self.assertEqual(timeline.activities, original)


if __name__ == "__main__":
    unittest.main()
