import logging
import re
import threading
import time
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import BadRequest, PermissionDenied, RequestDataTooBig, SuspiciousOperation
from django.http import Http404, JsonResponse

logger = logging.getLogger("trips.api")


def error_response(code, message, status, request_id, fields=None):
    return JsonResponse({"error": {"code": code, "message": message, "fields": fields or {}, "request_id": request_id}}, status=status)


def framework_error(request, status):
    code, message = {
        400: ("bad_request", "The request could not be processed."),
        403: ("forbidden", "This request is not permitted."),
        404: ("not_found", "This API endpoint does not exist."),
        405: ("method_not_allowed", "Use an allowed HTTP method for this endpoint."),
        413: ("body_too_large", "The request body is too large."),
    }.get(status, ("internal_error", "An unexpected error interrupted planning. Try again."))
    log = logger.error if status >= 500 else logger.warning
    log("api_failure id=%s status=%s", request.request_id, status)
    return error_response(code, message, status, request.request_id)


class StripQueryFilter(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, tuple):
            record.args = tuple(re.sub(r"\?[^ \"']*", "?[redacted]", item) if isinstance(item, str) else item for item in record.args)
        return True


class Throttle:
    def __init__(self):
        self.lock = threading.Lock()
        self.windows = {}

    def allowed(self, ip, category, maximum):
        now = time.monotonic()
        with self.lock:
            self.windows = {key: value for key, value in self.windows.items() if now - value[0] < 60}
            key = (ip, category)
            if key not in self.windows and len(self.windows) >= 2048:
                return False
            start, count = self.windows.get(key, (now, 0))
            if count >= maximum:
                return False
            self.windows[key] = (start, count + 1)
            return True


throttle = Throttle()


class ApiSafetyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = str(uuid4())
        start = time.monotonic()
        is_api = request.path.startswith("/api/")
        maximum = 6 if request.path.endswith("/trips") else 30
        if is_api and not throttle.allowed(request.META.get("REMOTE_ADDR", "unknown"), request.path, maximum):
            response = error_response("rate_limit", "Too many requests. Please wait a minute.", 429, request.request_id)
            response["Retry-After"] = "60"
        else:
            response = self.check_body_size(request) if is_api else None
            if response is None:
                response = self.get_response(request)
        if is_api and response.status_code >= 400 and not isinstance(response, JsonResponse):
            original = response
            response = framework_error(request, original.status_code)
            for header in ("Allow", "Retry-After", "Vary", "X-Frame-Options"):
                if header in original:
                    response[header] = original[header]
            response.cookies.update(original.cookies)
        response["X-Request-ID"] = request.request_id
        response["Cache-Control"] = "no-store"
        response["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        logger.info("request id=%s status=%s elapsed_ms=%d", request.request_id, response.status_code, (time.monotonic() - start) * 1000)
        return response

    @staticmethod
    def check_body_size(request):
        try:
            length = int(request.META.get("CONTENT_LENGTH") or 0)
        except (TypeError, ValueError):
            return framework_error(request, 400)
        if length < 0:
            return framework_error(request, 400)
        limit = settings.DATA_UPLOAD_MAX_MEMORY_SIZE
        if limit is not None and length > limit:
            return framework_error(request, 413)
        return None

    def process_exception(self, request, exception):
        if not request.path.startswith("/api/"):
            return None
        if isinstance(exception, RequestDataTooBig):
            status = 413
        elif isinstance(exception, (BadRequest, SuspiciousOperation)):
            status = 400
        elif isinstance(exception, PermissionDenied):
            status = 403
        elif isinstance(exception, Http404):
            status = 404
        else:
            status = 500
        return framework_error(request, status)
