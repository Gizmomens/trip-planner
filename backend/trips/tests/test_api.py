import json
import logging
from unittest.mock import patch

from django.core.exceptions import RequestDataTooBig
from django.http import HttpResponse
from django.test import Client, RequestFactory, SimpleTestCase, override_settings

from trips.api.middleware import ApiSafetyMiddleware, StripQueryFilter, throttle
from trips.api.validation import signed_location
from trips.domain.assumptions import Limits
from trips.domain.errors import PlanningError
from trips.domain.models import Location
from trips.services.budget import Budget
from trips.tests.test_planner import RoadProvider


@override_settings(DEBUG=True, SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["localhost", "testserver"], TOMTOM_API_KEY="test-private", TOMTOM_MAP_KEY="test-public")
class ApiTests(SimpleTestCase):
    def setUp(self):
        with throttle.lock:
            throttle.windows.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.bootstrap = self.client.get("/api/v1/bootstrap").json()
        self.body = {
            "current": signed_location(Location("0", "Origin", "Origin, TX", 35, -120))["token"],
            "pickup": signed_location(Location("20", "Pickup", "Pickup, TX", 35, -119.8))["token"],
            "dropoff": signed_location(Location("100", "Dropoff", "Dropoff, TX", 35, -119))["token"],
            "cycle_used_hours": 0,
            "planning_token": self.bootstrap["planning_token"],
        }

    def post(self, body=None):
        return self.client.post("/api/v1/trips", json.dumps(self.body if body is None else body),
                                content_type="application/json", HTTP_X_CSRFTOKEN=self.bootstrap["csrf_token"])

    def test_bootstrap_exposes_only_public_key(self):
        self.assertEqual(self.bootstrap["map_key"], "test-public")
        self.assertNotIn("test-private", json.dumps(self.bootstrap))
        self.assertIn("08:00:00-06:00", self.bootstrap["departure_at"])
        self.assertEqual(self.bootstrap["limits"]["provider_requests"], 100)
        self.assertEqual(self.bootstrap["assumptions_version"], "2")
        self.assertIn("A11", self.bootstrap["assumption_ids"])
        self.assertNotIn("assumptions", self.bootstrap)

    def test_csrf_required_for_anonymous_trip(self):
        response = self.client.post("/api/v1/trips", self.body, content_type="application/json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "csrf_failed")

    def test_missing_provider_configuration(self):
        with override_settings(TOMTOM_API_KEY=""):
            response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "provider_not_configured")

    def test_retryable_planning_error_includes_retry_after_header(self):
        error = PlanningError("provider_quota", "The provider rate limit was reached. Try later.", 429, retry_after=60)
        with patch("trips.api.views.TomTom") as adapter:
            adapter.return_value.__enter__.side_effect = error
            response = self.post()
        self.assert_api_error(response, 429, "provider_quota")
        self.assertEqual(response["Retry-After"], "60")

    def test_trip_contract_with_authored_routes(self):
        provider = RoadProvider()
        with patch("trips.api.views.TomTom") as adapter:
            adapter.return_value.__enter__.return_value = provider
            response = self.post()
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(len(result["days"]), 1)
        self.assertEqual(sum(result["days"][0]["totals"].values()), 86400)
        self.assertEqual(result["summary"]["on_duty_seconds"], 7200)
        self.assertEqual(result["stops"][-1]["location"]["name"], "Dropoff")
        self.assertEqual(result["assumption_ids"], self.bootstrap["assumption_ids"])
        self.assertNotIn("assumptions", result)
        self.assertNotIn("test-private", response.content.decode())

    def test_tampered_selection_and_planning_context(self):
        for field in ("current", "planning_token"):
            body = {**self.body, field: self.body[field] + "x"}
            self.assertEqual(self.post(body).status_code, 400)

    def test_invalid_cycle_input(self):
        for value in (-1, 193, True, "many"):
            response = self.post({**self.body, "cycle_used_hours": value})
            self.assertEqual(response.status_code, 400)
            self.assertIn("cycle_used_hours", response.json()["error"]["fields"])

    def test_nonfinite_and_malformed_json(self):
        for body in ('{"cycle_used_hours":NaN}', '{', '[]'):
            response = self.client.post("/api/v1/trips", body, content_type="application/json",
                                        HTTP_X_CSRFTOKEN=self.bootstrap["csrf_token"])
            self.assertEqual(response.status_code, 400)

    def test_content_type_and_size(self):
        response = self.client.post("/api/v1/trips", "x", content_type="text/plain",
                                    HTTP_X_CSRFTOKEN=self.bootstrap["csrf_token"])
        self.assertEqual(response.status_code, 415)
        response = self.client.post("/api/v1/trips", json.dumps({"huge": "x" * 20_000}), content_type="application/json",
                                    HTTP_X_CSRFTOKEN=self.bootstrap["csrf_token"])
        self.assertEqual(response.status_code, 413)

    def test_methods_and_lookup_validation(self):
        self.assertEqual(self.client.get("/api/v1/trips").status_code, 405)
        self.assertEqual(self.client.get("/api/v1/locations", {"q": "ab"}).status_code, 400)
        self.assertEqual(self.client.get("/api/v1/locations", {"q": "a" * 201}).status_code, 400)

    def test_safe_access_log(self):
        record = logging.LogRecord("django.server", logging.INFO, "", 1, '"%s" %s', ("GET /api/v1/locations?q=privateAddress HTTP/1.1", 200), None)
        StripQueryFilter().filter(record)
        self.assertNotIn("privateAddress", record.getMessage())

    def test_rate_limit_is_bounded(self):
        for _ in range(6):
            self.post({**self.body, "cycle_used_hours": -1})
        response = self.post()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)

    def assert_api_error(self, response, status, code):
        self.assertEqual(response.status_code, status)
        self.assertEqual(response["Content-Type"], "application/json")
        error = response.json()["error"]
        self.assertEqual(set(error), {"code", "message", "fields", "request_id"})
        self.assertEqual(error["code"], code)
        self.assertEqual(error["request_id"], response["X-Request-ID"])
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_unknown_endpoint_is_json_in_both_debug_modes(self):
        for debug in (True, False):
            with self.subTest(debug=debug), override_settings(DEBUG=debug):
                self.assert_api_error(self.client.get("/api/v1/unknown"), 404, "not_found")

    def test_oversized_forms_fail_before_csrf_parsing(self):
        for debug in (True, False):
            for content_type in ("multipart/form-data", "application/x-www-form-urlencoded"):
                with self.subTest(debug=debug, content_type=content_type), override_settings(DEBUG=debug):
                    response = self.client.post("/api/v1/trips", "field=" + "x" * 20_000, content_type=content_type,
                                                HTTP_X_CSRFTOKEN=self.bootstrap["csrf_token"])
                    self.assert_api_error(response, 413, "body_too_large")

    def test_unexpected_failures_are_safe_and_logged(self):
        marker = "PRIVATE_PROVIDER_PAYLOAD"
        for debug in (True, False):
            with self.subTest(debug=debug), override_settings(DEBUG=debug), patch("trips.api.views.TomTom") as adapter:
                adapter.return_value.__enter__.return_value.lookup.side_effect = RuntimeError(marker)
                with self.assertLogs("trips.api", level="INFO") as logs:
                    response = self.client.get("/api/v1/locations", {"q": "Austin"})
                self.assert_api_error(response, 500, "internal_error")
                self.assertNotIn(marker, response.content.decode())
                self.assertNotIn(marker, "\n".join(logs.output))
                self.assertTrue(any("api_failure" in message for message in logs.output))
                self.assertTrue(any(response["X-Request-ID"] in message for message in logs.output))

    def test_body_parser_exception_is_structured(self):
        with patch("trips.api.views.trip_input", side_effect=RequestDataTooBig("private parser detail")):
            self.assert_api_error(self.post(), 413, "body_too_large")

    def test_framework_error_preserves_method_header_without_body(self):
        request = RequestFactory().get("/api/v1/unknown")
        original = HttpResponse("private diagnostic body", status=405, headers={"Allow": "POST"})
        response = ApiSafetyMiddleware(lambda request: original)(request)
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response["Allow"], "POST")
        self.assertEqual(json.loads(response.content)["error"]["code"], "method_not_allowed")
        self.assertNotIn("private", response.content.decode())

    def test_invalid_declared_body_length_is_structured(self):
        request = RequestFactory().get("/api/v1/bootstrap")
        for length in ("invalid", "-1"):
            with self.subTest(length=length):
                request.META["CONTENT_LENGTH"] = length
                response = ApiSafetyMiddleware(lambda request: self.fail("Invalid length reached the view"))(request)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(json.loads(response.content)["error"]["code"], "bad_request")

    def test_framework_form_parser_failure_is_json(self):
        for debug in (True, False):
            with self.subTest(debug=debug), override_settings(DEBUG=debug, DATA_UPLOAD_MAX_NUMBER_FIELDS=1):
                response = self.client.post("/api/v1/trips", "a=1&b=2", content_type="application/x-www-form-urlencoded",
                                            HTTP_X_CSRFTOKEN=self.bootstrap["csrf_token"])
                self.assert_api_error(response, 400, "bad_request")

    def test_expired_trip_is_not_serialized(self):
        now = [0]
        budget = Budget(Limits(), clock=lambda: now[0])
        def finish_late(*args):
            now[0] = 121
            return {"must_not_be_returned": True}
        with patch("trips.api.views.Budget", return_value=budget), patch("trips.api.views.TomTom"), \
                patch("trips.api.views.Planner") as planner, patch("trips.api.views.JsonResponse") as serializer:
            planner.return_value.plan.side_effect = finish_late
            response = self.post()
        self.assert_api_error(response, 504, "deadline_exceeded")
        serializer.assert_not_called()

    def test_serialization_deadline_returns_error(self):
        from django.http import JsonResponse

        now = [0]
        budget = Budget(Limits(), clock=lambda: now[0])
        def serialize_late(data):
            response = JsonResponse(data)
            now[0] = 121
            return response
        with patch("trips.api.views.Budget", return_value=budget), patch("trips.api.views.TomTom") as adapter, \
                patch("trips.api.views.JsonResponse", side_effect=serialize_late):
            adapter.return_value.__enter__.return_value = RoadProvider()
            response = self.post()
        self.assert_api_error(response, 504, "deadline_exceeded")
        self.assertNotIn("route", response.json())

    def test_lookup_serialization_deadline_returns_error(self):
        from django.http import JsonResponse

        now = [0]
        budget = Budget(Limits(processing_seconds=20), clock=lambda: now[0])
        def serialize_late(data):
            response = JsonResponse(data)
            now[0] = 21
            return response
        with patch("trips.api.views.Budget", return_value=budget), patch("trips.api.views.TomTom") as adapter, \
                patch("trips.api.views.JsonResponse", side_effect=serialize_late):
            adapter.return_value.__enter__.return_value.lookup.return_value = []
            response = self.client.get("/api/v1/locations", {"q": "Austin"})
        self.assert_api_error(response, 504, "deadline_exceeded")
