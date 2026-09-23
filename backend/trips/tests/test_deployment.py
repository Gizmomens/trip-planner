import json
import os
import subprocess
import sys
from pathlib import Path

from django.test import Client, SimpleTestCase, override_settings

from config.wsgi import application

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPOSITORY_ROOT / "backend"


class DeploymentTests(SimpleTestCase):
    def test_wsgi_application_is_importable(self):
        self.assertTrue(callable(application))

    def test_vercel_services_keep_api_same_origin(self):
        config = json.loads((REPOSITORY_ROOT / "vercel.json").read_text(encoding="utf-8"))
        self.assertEqual(
            config["rewrites"],
            [
                {"source": "/api/(.*)", "destination": {"service": "backend"}},
                {"source": "/(.*)", "destination": {"service": "frontend"}},
            ],
        )
        self.assertEqual(config["services"]["frontend"]["root"], "frontend/")
        self.assertEqual(config["services"]["frontend"]["outputDirectory"], "dist")
        backend = config["services"]["backend"]
        self.assertEqual(backend["root"], "backend/")
        self.assertNotIn("runtime", backend)
        self.assertEqual(backend["entrypoint"], "config.wsgi:application")
        self.assertEqual(backend["functions"]["config/wsgi.py"]["maxDuration"], 180)

    def test_vercel_system_hosts_are_added_without_wildcards(self):
        environment = {
            **os.environ,
            "DJANGO_DEBUG": "false",
            "DJANGO_SECRET_KEY": "deployment-test-secret-" * 3,
            "DJANGO_ALLOWED_HOSTS": "app.example.com,api.example.com",
            "VERCEL_URL": "preview-123.vercel.app",
            "VERCEL_BRANCH_URL": "spotter-feature.vercel.app",
            "VERCEL_PROJECT_PRODUCTION_URL": "spotter.example.com",
        }
        command = [
            sys.executable,
            "-c",
            "import json; from config.settings import ALLOWED_HOSTS; print(json.dumps(ALLOWED_HOSTS))",
        ]
        result = subprocess.run(
            command,
            cwd=BACKEND_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            [
                "app.example.com",
                "api.example.com",
                "preview-123.vercel.app",
                "spotter-feature.vercel.app",
                "spotter.example.com",
            ],
        )

    @override_settings(
        DEBUG=False,
        ALLOWED_HOSTS=["preview-123.vercel.app"],
        CSRF_COOKIE_SECURE=True,
        SECURE_SSL_REDIRECT=True,
    )
    def test_forwarded_https_avoids_redirect_and_sets_secure_csrf_cookie(self):
        client = Client()
        response = client.get(
            "/api/v1/bootstrap",
            HTTP_HOST="preview-123.vercel.app",
            HTTP_X_FORWARDED_PROTO="https",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.cookies["csrftoken"]["secure"])

        redirect = client.get("/api/v1/bootstrap", HTTP_HOST="preview-123.vercel.app")
        self.assertEqual(redirect.status_code, 301)
        self.assertTrue(redirect["Location"].startswith("https://"))
