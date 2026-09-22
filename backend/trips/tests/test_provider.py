import asyncio
import threading
import unittest
from datetime import datetime
from unittest.mock import patch

import httpx

from trips.domain.assumptions import Limits, MILE_METERS, TERMINAL_TZ
from trips.domain.errors import PlanningError
from trips.domain.models import Location
from trips.providers.tomtom import TomTom, number, parse_places, parse_route
from trips.services.budget import Budget
from trips.services.planner import Planner


def route_payload():
    return {"routes": [{
        "summary": {"lengthInMeters": 1000, "travelTimeInSeconds": 100},
        "legs": [{"points": [{"longitude": -97, "latitude": 30}, {"longitude": -96, "latitude": 31}]}],
        "sections": [
            {"sectionType": "COUNTRY", "countryCode": "USA", "startPointIndex": 0, "endPointIndex": 1},
            {"sectionType": "TRAVEL_MODE", "travelMode": "truck", "startPointIndex": 0, "endPointIndex": 1},
        ],
        "progress": [
            {"pointIndex": 0, "travelTimeInSeconds": 0, "distanceInMeters": 0},
            {"pointIndex": 1, "travelTimeInSeconds": 100, "distanceInMeters": 1000},
        ],
        "guidance": {"instructions": [{
            "message": "Continue on the road", "routeOffsetInMeters": 0,
            "travelTimeInSeconds": 0, "point": {"longitude": -97, "latitude": 30},
        }]},
    }]}


class ChunkStream(httpx.AsyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks
        self.reads = 0
        self.closed = False

    async def __aiter__(self):
        for chunk in self.chunks:
            self.reads += 1
            yield chunk

    async def aclose(self):
        self.closed = True


class PendingStream(ChunkStream):
    def __init__(self):
        super().__init__([b'{"results":'])
        self.cancelled = False

    async def __aiter__(self):
        try:
            async for chunk in super().__aiter__():
                yield chunk
            await asyncio.Event().wait()
        finally:
            self.cancelled = True


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.a = Location("a", "A", "A, TX", 30, -97)
        self.b = Location("b", "B", "B, TX", 31, -96)

    def test_route_preserves_provider_progress(self):
        result = parse_route(route_payload(), self.a, self.b)
        self.assertEqual(result.seconds, 100)
        self.assertEqual(result.progress[-1].meters, 1000)

    def test_unsupported_and_incomplete_sections_rejected(self):
        for sections in ([], [{"sectionType": "COUNTRY", "countryCode": "CA", "startPointIndex": 0, "endPointIndex": 1}]):
            payload = route_payload()
            payload["routes"][0]["sections"] = sections
            with self.assertRaises(PlanningError):
                parse_route(payload, self.a, self.b)

    def test_missing_progress_rejected(self):
        payload = route_payload()
        del payload["routes"][0]["progress"]
        with self.assertRaises(PlanningError):
            parse_route(payload, self.a, self.b)

    def test_actual_facilities_and_state_filter(self):
        item = {"id": "poi1", "title": "Example Fuel", "position": {"coordinates": [-97, 30]},
                "address": {"countryCodeIso2": "US", "countrySubdivisionCodeIso": "US-TX", "municipality": "Austin"},
                "poiTypes": [{"id": "fuel_station"}]}
        self.assertEqual(parse_places({"results": [item]}, facilities=True)[0].kind, "fuel_station")
        item["address"]["countrySubdivisionCodeIso"] = "US-HI"
        self.assertEqual(parse_places({"results": [item]}, facilities=True), [])

    def test_empty_places_payload_means_no_results(self):
        self.assertEqual(parse_places({}, facilities=False), [])
        self.assertEqual(parse_places({}, facilities=True), [])

    def test_nonempty_places_payload_without_results_is_rejected(self):
        with self.assertRaises(PlanningError) as caught:
            parse_places({"unexpected": []}, facilities=True)
        self.assertEqual(caught.exception.code, "provider_data")

    def test_credentials_never_in_errors(self):
        for status, code in ((403, "provider_credentials"), (429, "provider_quota"), (302, "provider_failure")):
            transport = httpx.MockTransport(lambda request: httpx.Response(status, json={"key": "secret"}))
            with TomTom("secret", Budget(Limits()), transport=transport) as provider:
                with self.assertRaises(PlanningError) as caught:
                    provider.lookup("Austin")
                self.assertEqual(caught.exception.code, code)
                self.assertNotIn("secret", str(caught.exception))

    def test_retry_and_repeated_requests_without_caching(self):
        calls = []
        def respond(request):
            calls.append(request)
            return httpx.Response(503 if len(calls) == 1 else 200, json={"results": []})
        budget = Budget(Limits())
        with TomTom("test", budget, transport=httpx.MockTransport(respond)) as provider:
            provider.lookup("Austin")
            provider.lookup("Austin")
        self.assertEqual(len(calls), 3)
        self.assertEqual(budget.requests, 3)

    def test_repeated_requests_still_consume_the_budget(self):
        calls = []
        def respond(request):
            calls.append(request)
            return httpx.Response(200, json={"results": []})
        budget = Budget(Limits(provider_requests=1))
        with TomTom("test", budget, transport=httpx.MockTransport(respond)) as provider:
            provider.lookup("Austin")
            with self.assertRaises(PlanningError) as caught:
                provider.lookup("Austin")
        self.assertEqual(caught.exception.code, "request_limit")
        self.assertEqual(len(calls), 1)

    def test_invalid_numbers_become_provider_errors(self):
        for value in (10 ** 400, -(10 ** 400), float("inf"), float("nan"), -1, True, "1", None):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(PlanningError) as caught:
                number(value)
            self.assertEqual(caught.exception.code, "provider_data")
            self.assertEqual(caught.exception.status, 502)
        self.assertEqual(number(0), 0.0)
        self.assertEqual(number(1.5), 1.5)

    def test_oversized_provider_coordinates_are_rejected(self):
        item = {"id": "poi", "title": "Example", "position": {"coordinates": [10 ** 400, 30]},
                "address": {"countryCodeIso2": "US", "countrySubdivisionCodeIso": "US-TX"}}
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"results": [item]}))
        with TomTom("test", Budget(Limits()), transport=transport) as provider:
            with self.assertRaises(PlanningError) as caught:
                provider.lookup("Austin")
        self.assertEqual(caught.exception.code, "provider_data")

    def test_oversized_route_numbers_are_rejected(self):
        for section, field in (("summary", "lengthInMeters"), ("summary", "travelTimeInSeconds"),
                               ("progress", "travelTimeInSeconds"), ("progress", "distanceInMeters")):
            with self.subTest(section=section, field=field):
                payload = route_payload()
                target = payload["routes"][0][section]
                if section == "progress":
                    target = target[-1]
                target[field] = 10 ** 400
                with self.assertRaises(PlanningError) as caught:
                    parse_route(payload, self.a, self.b)
                self.assertEqual(caught.exception.code, "provider_data")

    def test_unexpected_compression_is_rejected_without_reading(self):
        for encoding in ("gzip", "deflate", "br"):
            with self.subTest(encoding=encoding):
                stream = ChunkStream([b"must not be decoded"])
                def respond(request):
                    self.assertEqual(request.headers["Accept-Encoding"], "identity")
                    return httpx.Response(200, headers={"Content-Encoding": encoding}, stream=stream)
                with TomTom("test", Budget(Limits()), transport=httpx.MockTransport(respond)) as provider:
                    with self.assertRaises(PlanningError) as caught:
                        provider.lookup("Austin")
                self.assertEqual(caught.exception.code, "provider_data")
                self.assertEqual(stream.reads, 0)
                self.assertTrue(stream.closed)

    def test_exact_response_limit_is_accepted(self):
        stream = ChunkStream([b" " * (8_000_000 - 14), b'{"results":[]}'])
        transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=stream))
        with TomTom("test", Budget(Limits()), transport=transport) as provider:
            self.assertEqual(provider.lookup("Austin"), [])
        self.assertTrue(stream.closed)

    def test_response_over_limit_stops_before_next_chunk(self):
        stream = ChunkStream([b"x" * 8_000_000, b"x", b"must not be read"])
        transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=stream))
        with TomTom("test", Budget(Limits()), transport=transport) as provider:
            with self.assertRaises(PlanningError) as caught:
                provider.lookup("Austin")
        self.assertEqual(caught.exception.code, "provider_data_limit")
        self.assertEqual(stream.reads, 2)
        self.assertTrue(stream.closed)

    def test_absolute_deadline_cancels_pending_body_and_releases_resources(self):
        stream = PendingStream()
        transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=stream))
        connections = threading.BoundedSemaphore(1)
        timeout = asyncio.timeout
        with patch("trips.providers.tomtom._connections", connections), \
                patch("trips.providers.tomtom.asyncio.timeout", side_effect=lambda remaining: timeout(0)) as timer:
            with TomTom("test", Budget(Limits()), transport=transport) as provider:
                with self.assertRaises(PlanningError) as caught:
                    provider.lookup("Austin")
            self.assertEqual(caught.exception.code, "deadline_exceeded")
            self.assertEqual(caught.exception.status, 504)
            self.assertEqual(timer.call_count, 1)
            self.assertGreater(timer.call_args.args[0], 0)
            self.assertLessEqual(timer.call_args.args[0], 120)
            self.assertEqual(stream.reads, 1)
            self.assertTrue(stream.cancelled)
            self.assertTrue(stream.closed)
            self.assertTrue(provider.client.is_closed)
            self.assertTrue(connections.acquire(blocking=False))
            connections.release()
            with self.assertRaises(RuntimeError):
                provider._runner.get_loop()

    def test_absolute_deadline_cancels_waiting_for_headers(self):
        cancelled = []
        async def respond(request):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(True)
        timeout = asyncio.timeout
        with patch("trips.providers.tomtom.asyncio.timeout", side_effect=lambda remaining: timeout(0)):
            with TomTom("test", Budget(Limits()), transport=httpx.MockTransport(respond)) as provider:
                with self.assertRaises(PlanningError) as caught:
                    provider.lookup("Austin")
        self.assertEqual(caught.exception.code, "deadline_exceeded")
        self.assertEqual(cancelled, [True])
        self.assertTrue(provider.client.is_closed)

    def test_retry_uses_remaining_deadline_without_resetting_it(self):
        now = [0]
        calls = []
        def respond(request):
            calls.append(request)
            now[0] = 60
            return httpx.Response(503 if len(calls) == 1 else 200, json={"results": []})
        timeout = asyncio.timeout
        budget = Budget(Limits(), clock=lambda: now[0])
        with patch("trips.providers.tomtom.asyncio.timeout", side_effect=lambda remaining: timeout(None)) as timer:
            with TomTom("test", budget, transport=httpx.MockTransport(respond)) as provider:
                self.assertEqual(provider.lookup("Austin"), [])
        self.assertEqual([call.args[0] for call in timer.call_args_list], [120, 60])
        self.assertEqual(budget.requests, 2)

    def test_transport_failures_keep_specific_safe_errors(self):
        for failure, code in ((httpx.ReadTimeout("private"), "provider_timeout"),
                              (httpx.ConnectError("private"), "provider_unavailable")):
            with self.subTest(code=code):
                def respond(request):
                    raise failure
                connections = threading.BoundedSemaphore(1)
                with patch("trips.providers.tomtom._connections", connections):
                    with TomTom("test", Budget(Limits()), transport=httpx.MockTransport(respond)) as provider:
                        with self.assertRaises(PlanningError) as caught:
                            provider.lookup("Austin")
                    self.assertEqual(caught.exception.code, code)
                    self.assertNotIn("private", str(caught.exception))
                    self.assertTrue(provider.client.is_closed)
                    self.assertTrue(connections.acquire(blocking=False))
                    connections.release()

    def test_connection_wait_reports_deadline_without_releasing_unowned_permit(self):
        now = [0]
        budget = Budget(Limits(processing_seconds=20), clock=lambda: now[0])
        def expire_while_waiting(**kwargs):
            now[0] = 21
            return False
        with patch("trips.providers.tomtom._connections") as connections:
            connections.acquire.side_effect = expire_while_waiting
            transport = httpx.MockTransport(lambda request: self.fail("Expired request reached the provider"))
            with TomTom("test", budget, transport=transport) as provider:
                with self.assertRaises(PlanningError) as caught:
                    provider.lookup("Austin")
            self.assertEqual(caught.exception.code, "deadline_exceeded")
            connections.release.assert_not_called()

    def test_caps_and_deadline(self):
        now = [0]
        budget = Budget(Limits(provider_requests=1, processing_seconds=10), clock=lambda: now[0])
        budget.request()
        with self.assertRaises(PlanningError):
            budget.request()
        now[0] = 11
        with self.assertRaises(PlanningError):
            budget.check()

    def test_only_documented_route_unavailable_errors_are_recoverable(self):
        for upstream, expected in (("NO_ROUTE_FOUND", "no_route"), ("MAP_MATCHING_FAILURE", "no_route"), ("BAD_INPUT", "provider_failure")):
            with self.subTest(upstream=upstream):
                transport = httpx.MockTransport(lambda request: httpx.Response(400, json={"detailedError": {"code": upstream, "message": "private upstream details"}}))
                budget = Budget(Limits())
                with TomTom("secret", budget, transport=transport) as provider:
                    with self.assertRaises(PlanningError) as caught:
                        provider.route(self.a, self.b)
                self.assertEqual(caught.exception.code, expected)
                self.assertNotIn("private", str(caught.exception))
                self.assertEqual(budget.requests, 1)

    def test_places_error_cannot_masquerade_as_unroutable_candidate(self):
        transport = httpx.MockTransport(lambda request: httpx.Response(400, json={"detailedError": {"code": "NO_ROUTE_FOUND"}}))
        with TomTom("test", Budget(Limits()), transport=transport) as provider:
            with self.assertRaises(PlanningError) as caught:
                provider.lookup("Austin")
        self.assertEqual(caught.exception.code, "provider_failure")

    def test_unreachable_first_facility_does_not_hide_reachable_second(self):
        attempted = []
        def respond(request):
            if request.method == "POST":
                return httpx.Response(200, json={"results": [
                    {"id": str(mile), "title": f"Rest {mile}", "position": {"coordinates": [-120 + mile / 100, 35]},
                     "address": {"countryCodeIso2": "US", "countrySubdivisionCodeIso": "US-TX", "municipality": "Example"},
                     "poiTypes": [{"id": "rest_area"}]}
                    for mile in (432, 400)
                ]})
            origin, destination = request.url.path.split("/")[4].split(":")
            lat1, lon1 = map(float, origin.split(","))
            lat2, lon2 = map(float, destination.split(","))
            attempted.append(lon2)
            if abs(lon2 - (-115.68)) < 0.0001:
                return httpx.Response(400, json={"detailedError": {"code": "NO_ROUTE_FOUND"}})
            miles = abs(lon2 - lon1) * 100
            data = route_payload()
            route = data["routes"][0]
            route["summary"] = {"lengthInMeters": miles * MILE_METERS, "travelTimeInSeconds": round(miles * 60)}
            route["legs"][0]["points"] = [{"latitude": lat1, "longitude": lon1}, {"latitude": lat2, "longitude": lon2}]
            route["progress"][-1].update(distanceInMeters=miles * MILE_METERS, travelTimeInSeconds=round(miles * 60))
            route["guidance"]["instructions"][0]["point"] = {"latitude": lat1, "longitude": lon1}
            return httpx.Response(200, json=data)
        origin = Location("origin", "Origin", "Origin, TX", 35, -120)
        pickup = Location("pickup", "Pickup", "Pickup, TX", 35, -120)
        destination = Location("destination", "Destination", "Destination, TX", 35, -114)
        budget = Budget(Limits())
        with TomTom("test", budget, transport=httpx.MockTransport(respond)) as provider:
            result = Planner(provider, budget).plan([origin, pickup, destination], datetime(2026, 9, 21, 8, tzinfo=TERMINAL_TZ), 0)
        self.assertIn(-115.68, attempted)
        self.assertIn(-116, attempted)
        self.assertIn("400", [stop["location"]["id"] for stop in result["stops"]])
        self.assertNotIn("432", [stop["location"]["id"] for stop in result["stops"]])
        self.assertAlmostEqual(result["summary"]["distance_meters"], 600 * MILE_METERS)
        self.assertEqual(budget.requests, 6)


if __name__ == "__main__":
    unittest.main()
