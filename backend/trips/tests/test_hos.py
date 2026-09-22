import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from trips.domain.assumptions import FUEL_RANGE_METERS, TERMINAL_TZ
from trips.domain.errors import PlanningError
from trips.domain.hos import HOSState
from trips.domain.models import Activity, Location, RoutePoint
from trips.domain.validation import validate_timeline

HOUR = 3600
PLACE = Location("origin", "Origin", "Origin, TX", 30, -100)
START = datetime(2026, 9, 21, 8, tzinfo=TERMINAL_TZ)


class Timeline:
    def __init__(self, start=START):
        self.now = start
        self.activities = []

    def add(self, status, seconds, purpose=None, meters=0):
        purpose = purpose or {"driving": "driving", "on_duty": "pickup",
                              "off_duty": "break", "sleeper": "daily_rest"}[status]
        activity = Activity(
            f"a{len(self.activities) + 1}", status, purpose,
            self.now, self.now + timedelta(seconds=seconds), PLACE, PLACE, meters,
        )
        self.activities.append(activity)
        self.now = activity.end_at
        return activity


class HOSStateTests(unittest.TestCase):
    def test_initial_cycle_is_independent_of_fresh_shift(self):
        for initial, expected in [(0, 8 * HOUR), (62 * HOUR, 8 * HOUR),
                                  (70 * HOUR - 1, 1), (70 * HOUR, 0), (80 * HOUR, 0)]:
            with self.subTest(initial=initial):
                state = HOSState(initial)
                self.assertEqual(state.cycle_seconds, initial)
                self.assertEqual(state.driving_seconds, 0)
                self.assertEqual(state.allowance(START), expected)

    def test_cycle_input_rejects_noninteger_or_negative_values(self):
        for initial in [-1, 1.5, True, float("nan"), "0"]:
            with self.subTest(initial=initial), self.assertRaises(PlanningError):
                HOSState(initial)

    def test_eight_hour_exact_and_over_boundary(self):
        timeline = Timeline()
        state = HOSState(0)
        state.apply(timeline.add("driving", 8 * HOUR))
        self.assertEqual(state.allowance(timeline.now), 0)
        with self.assertRaises(PlanningError) as caught:
            state.apply(timeline.add("driving", 1))
        self.assertEqual(caught.exception.code, "hos_limit")
        self.assertEqual(state.driving_seconds, 8 * HOUR)

    def test_break_combines_adjacent_non_driving_statuses(self):
        timeline = Timeline()
        state = HOSState(0)
        state.apply(timeline.add("driving", 8 * HOUR))
        state.apply(timeline.add("on_duty", 10 * 60))
        state.apply(timeline.add("off_duty", 10 * 60))
        state.apply(timeline.add("sleeper", 10 * 60 - 1))
        self.assertEqual(state.allowance(timeline.now), 0)
        state.apply(timeline.add("on_duty", 1))
        self.assertEqual(state.allowance(timeline.now), 3 * HOUR)

    def test_driving_interrupts_fragmented_breaks(self):
        timeline = Timeline()
        for status, seconds in [("driving", 4 * HOUR), ("off_duty", 15 * 60),
                                ("driving", HOUR), ("on_duty", 15 * 60),
                                ("driving", 3 * HOUR)]:
            timeline.add(status, seconds)
        state = validate_timeline(timeline.activities, 0)
        self.assertEqual(state.allowance(timeline.now), 0)

    def test_eleven_hour_boundary_after_qualifying_break(self):
        timeline = Timeline()
        timeline.add("driving", 8 * HOUR)
        timeline.add("off_duty", 30 * 60)
        timeline.add("driving", 3 * HOUR)
        state = validate_timeline(timeline.activities, 0)
        self.assertEqual(state.driving_seconds, 11 * HOUR)
        self.assertEqual(state.allowance(timeline.now), 0)
        timeline.add("driving", 1)
        with self.assertRaises(PlanningError):
            validate_timeline(timeline.activities, 0)

    def test_fourteen_hour_window_includes_break_and_loading(self):
        timeline = Timeline()
        timeline.add("on_duty", 6 * HOUR)
        timeline.add("driving", HOUR)
        timeline.add("off_duty", 6 * HOUR)
        state = validate_timeline(timeline.activities, 0)
        self.assertEqual(state.allowance(timeline.now), HOUR)
        state.apply(timeline.add("driving", HOUR))
        self.assertEqual(state.allowance(timeline.now), 0)
        state.apply(timeline.add("on_duty", 2 * HOUR, "dropoff"))
        self.assertEqual(state.cycle_seconds, 10 * HOUR)
        with self.assertRaises(PlanningError):
            state.apply(timeline.add("driving", 1))

    def test_on_duty_work_may_exceed_seventy_hour_limit(self):
        timeline = Timeline()
        timeline.add("driving", 1)
        timeline.add("on_duty", 3 * HOUR, "dropoff")
        state = validate_timeline(timeline.activities, 70 * HOUR - 1)
        self.assertEqual(state.cycle_seconds, 73 * HOUR)
        self.assertEqual(state.allowance(timeline.now), 0)

    def test_ten_and_thirty_four_hour_thresholds(self):
        timeline = Timeline()
        state = HOSState(60 * HOUR)
        state.apply(timeline.add("driving", 8 * HOUR))
        state.apply(timeline.add("off_duty", 10 * HOUR - 1, "daily_rest"))
        self.assertEqual(state.driving_seconds, 8 * HOUR)
        self.assertEqual(state.allowance(timeline.now), 0)
        state.apply(timeline.add("sleeper", 1))
        self.assertEqual(state.driving_seconds, 0)
        self.assertEqual(state.allowance(timeline.now), 2 * HOUR)
        state.apply(timeline.add("off_duty", 24 * HOUR - 1, "cycle_restart"))
        self.assertEqual(state.cycle_seconds, 68 * HOUR)
        state.apply(timeline.add("off_duty", 1, "cycle_restart"))
        self.assertEqual(state.cycle_seconds, 0)
        self.assertEqual(state.allowance(timeline.now), 8 * HOUR)

    def test_work_interrupts_consecutive_daily_and_cycle_rest(self):
        timeline = Timeline()
        timeline.add("driving", HOUR)
        timeline.add("off_duty", 9 * HOUR, "daily_rest")
        timeline.add("on_duty", 1)
        timeline.add("off_duty", HOUR, "daily_rest")
        state = validate_timeline(timeline.activities, 69 * HOUR)
        self.assertEqual(state.driving_seconds, HOUR)
        self.assertEqual(state.cycle_seconds, 70 * HOUR + 1)
        timeline.add("off_duty", 23 * HOUR, "cycle_restart")
        self.assertEqual(validate_timeline(timeline.activities, 69 * HOUR).cycle_seconds, 70 * HOUR + 1)

    def test_midnight_does_not_reset_any_clock(self):
        timeline = Timeline(START.replace(hour=20))
        timeline.add("driving", 4 * HOUR)
        state = validate_timeline(timeline.activities, 65 * HOUR)
        self.assertEqual(state.driving_seconds, 4 * HOUR)
        self.assertEqual(state.cycle_seconds, 69 * HOUR)
        self.assertEqual(state.allowance(timeline.now), HOUR)

    def test_invalid_activity_does_not_mutate_state(self):
        timeline = Timeline()
        activity = timeline.add("driving", HOUR)
        variants = [
            replace(activity, end_at=activity.start_at),
            replace(activity, end_at=activity.start_at - timedelta(seconds=1)),
            replace(activity, start_at=activity.start_at.replace(tzinfo=None)),
            replace(activity, end_at=activity.end_at + timedelta(microseconds=1)),
            replace(activity, status="unknown"),
            replace(activity, purpose="fuel"),
            replace(activity, distance_meters=-1),
            replace(activity, distance_meters=float("nan")),
            replace(activity, status="off_duty", purpose="break", distance_meters=1),
        ]
        for invalid in variants:
            with self.subTest(activity=invalid):
                state = HOSState(0)
                with self.assertRaises(PlanningError):
                    state.apply(invalid)
                self.assertEqual(state.cycle_seconds, 0)
                state.apply(activity)
                self.assertEqual(state.driving_seconds, HOUR)

    def test_zero_distance_driving_with_positive_duration_is_supported(self):
        timeline = Timeline()
        state = HOSState(0)
        state.apply(timeline.add("driving", 1))
        self.assertEqual(state.driving_seconds, 1)

    def test_contiguity_compares_instants_not_timezone_labels(self):
        timeline = Timeline()
        first = timeline.add("driving", HOUR)
        second = timeline.add("driving", HOUR)
        state = HOSState(0)
        state.apply(first)
        state.apply(replace(second, start_at=second.start_at.astimezone(timezone.utc),
                            end_at=second.end_at.astimezone(timezone.utc)))
        self.assertEqual(state.driving_seconds, 2 * HOUR)

    def test_gaps_overlaps_and_past_queries_are_rejected(self):
        timeline = Timeline()
        first = timeline.add("driving", HOUR)
        next_activity = timeline.add("driving", HOUR)
        state = HOSState(0)
        state.apply(first)
        for shift in [-1, 1]:
            invalid = replace(next_activity, start_at=next_activity.start_at + timedelta(seconds=shift),
                              end_at=next_activity.end_at + timedelta(seconds=shift))
            with self.assertRaises(PlanningError):
                state.apply(invalid)
        with self.assertRaises(PlanningError):
            state.allowance(first.start_at)


class TimelineValidationTests(unittest.TestCase):
    def test_fuel_exact_limit_and_positive_excess(self):
        for distance in [FUEL_RANGE_METERS, FUEL_RANGE_METERS + 0.001]:
            timeline = Timeline()
            timeline.add("driving", HOUR, meters=distance)
            if distance == FUEL_RANGE_METERS:
                validate_timeline(timeline.activities, 0)
            else:
                with self.assertRaises(PlanningError) as caught:
                    validate_timeline(timeline.activities, 0)
                self.assertEqual(caught.exception.code, "fuel_limit")

    def test_only_completed_fueling_restores_range(self):
        for status, purpose, duration, legal in [
            ("on_duty", "fuel", 1800, True),
            ("on_duty", "fuel", 1799, False),
            ("on_duty", "pickup", HOUR, False),
            ("off_duty", "daily_rest", 10 * HOUR, False),
            ("off_duty", "cycle_restart", 34 * HOUR, False),
            ("off_duty", "fuel", 1800, False),
        ]:
            with self.subTest(status=status, purpose=purpose, duration=duration):
                timeline = Timeline()
                timeline.add("driving", HOUR, meters=FUEL_RANGE_METERS)
                timeline.add(status, duration, purpose)
                timeline.add("driving", HOUR, meters=1)
                if legal:
                    validate_timeline(timeline.activities, 0)
                else:
                    with self.assertRaises(PlanningError):
                        validate_timeline(timeline.activities, 0)

    def test_later_fueling_cannot_retroactively_legalize_arrival(self):
        timeline = Timeline()
        timeline.add("driving", HOUR, meters=FUEL_RANGE_METERS + 1)
        timeline.add("on_duty", 1800, "fuel")
        with self.assertRaises(PlanningError) as caught:
            validate_timeline(timeline.activities, 0)
        self.assertEqual(caught.exception.code, "fuel_limit")

    def test_fuel_qualifies_as_driving_break_but_not_daily_rest(self):
        timeline = Timeline()
        timeline.add("driving", 8 * HOUR)
        timeline.add("on_duty", 1800, "fuel")
        state = validate_timeline(timeline.activities, 0)
        self.assertEqual(state.allowance(timeline.now), 3 * HOUR)
        self.assertEqual(state.driving_seconds, 8 * HOUR)
        self.assertEqual(state.cycle_seconds, 8 * HOUR + 1800)

    def test_replay_rejects_hos_violations_and_duplicate_ids(self):
        timeline = Timeline()
        timeline.add("driving", 8 * HOUR + 1)
        with self.assertRaises(PlanningError):
            validate_timeline(timeline.activities, 0)
        timeline = Timeline()
        first = timeline.add("on_duty", HOUR)
        second = timeline.add("on_duty", HOUR)
        with self.assertRaises(PlanningError):
            validate_timeline([first, replace(second, id=first.id)], 0)

    def test_replay_rejects_location_jumps(self):
        timeline = Timeline()
        first = timeline.add("driving", HOUR)
        second = timeline.add("on_duty", HOUR)
        elsewhere = replace(PLACE, lon=-90)
        for invalid in [replace(second, start_location=elsewhere, end_location=elsewhere),
                        replace(second, end_location=elsewhere)]:
            with self.assertRaises(PlanningError):
                validate_timeline([first, invalid], 0)

    def test_replay_checks_progress_without_rejecting_fractional_timing(self):
        timeline = Timeline()
        activity = timeline.add("driving", 2, meters=1.5)
        valid = (RoutePoint(-100, 30, 0, 0), RoutePoint(-100, 30, 0.25, 0.5),
                 RoutePoint(-100, 30, 1.75, 1.5))
        validate_timeline([replace(activity, progress=valid)], 0)
        for progress in [
            valid[::-1],
            (valid[0], replace(valid[-1], meters=2)),
            (valid[0], replace(valid[-1], seconds=3)),
            (valid[0], replace(valid[-1], seconds=float("nan"))),
            (valid[0], replace(valid[-1], meters=1)),
            (valid[0], replace(valid[-1], seconds=0)),
        ]:
            with self.subTest(progress=progress), self.assertRaises(PlanningError):
                validate_timeline([replace(activity, progress=progress)], 0)

    def test_empty_timeline_preserves_initial_cycle(self):
        self.assertEqual(validate_timeline([], 70 * HOUR).cycle_seconds, 70 * HOUR)


if __name__ == "__main__":
    unittest.main()
