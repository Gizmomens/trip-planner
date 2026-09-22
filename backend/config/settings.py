import os
import secrets
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY, or enable local DJANGO_DEBUG.")
    SECRET_KEY = secrets.token_urlsafe(48)
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]").split(",")
ROOT_URLCONF = "config.urls"
INSTALLED_APPS = ["trips"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "trips.api.middleware.ApiSafetyMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
DATA_UPLOAD_MAX_MEMORY_SIZE = 16_384
CSRF_FAILURE_VIEW = "trips.api.views.csrf_failure"
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_SECURE = not DEBUG
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31_536_000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY", "")
TOMTOM_MAP_KEY = os.getenv("TOMTOM_MAP_KEY", "")
PLANNING_LIMITS = {
    "days": int(os.getenv("PLAN_MAX_DAYS", "30")),
    "facilities": int(os.getenv("PLAN_MAX_FACILITIES", "100")),
    "provider_requests": int(os.getenv("PLAN_MAX_REQUESTS", "100")),
    "processing_seconds": int(os.getenv("PLAN_TIMEOUT_SECONDS", "120")),
}
if any(value < 1 for value in PLANNING_LIMITS.values()):
    raise ImproperlyConfigured("Planning limits must be positive integers.")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"strip_query": {"()": "trips.api.middleware.StripQueryFilter"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "filters": ["strip_query"]}},
    "loggers": {
        "trips": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django.server": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "httpx": {"handlers": [], "level": "CRITICAL", "propagate": False},
        "httpcore": {"handlers": [], "level": "CRITICAL", "propagate": False},
    },
}
