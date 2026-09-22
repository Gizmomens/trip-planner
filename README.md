# Spotter

A Django + React trip planner for the supplied full-stack assessment. Enter the current, pickup and drop-off locations and cycle hours already used. The application plans a truck route through real mapped facilities, schedules duty/rest activities, and draws projected daily log sheets.

**Assessment planner, not a certified ELD or vehicle-specific navigation system.** Facility availability and permission to stop are assumed. The supplied April 2022 FMCSA guide is the rule reference.

## Local setup (PowerShell)

Prerequisites: Python 3.14 and Node 24/npm. The installed `python` command may select an older interpreter, so select Python explicitly.

From the project root:

```powershell
py -3.14 -m venv backend\.venv
Set-Location backend
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
```

Paste the generated value into `DJANGO_SECRET_KEY` in the local `backend\.env`. Keep `DJANGO_DEBUG=true` for local HTTP development only. Fill in the TomTom keys described below, then start the API:

```powershell
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

In a second terminal, from the project root:

```powershell
Set-Location frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local address printed by Vite. Its development proxy forwards `/api` to Django on port 8000. Use the frontend's address, not the API address, to use the app. No migrations, user account or database setup is needed.

### TomTom configuration

Use one TomTom account with two restricted keys:

| Local variable in `backend\.env` | Purpose |
| --- | --- |
| `TOMTOM_API_KEY` | Private server credential enabled for Places Search and truck-capable Routing API v1. Never put it in a `VITE_` variable. |
| `TOMTOM_MAP_KEY` | Public map-display-only credential with allowed-domain restrictions for the frontend. The browser necessarily receives this key. |

Enable the corresponding free services and verify the account's current quotas. Do not enable paid upgrades. The app uses Places Search Discover for address/POI lookup, Routing v1 with `travelMode=truck`, and raster map tiles. It does not use premium parking/fuel-price APIs or another provider.

Without keys, the UI renders an explicit configuration notice and the API returns a configuration error; there is no simulated-success fallback. With only the server key configured, textual planning can work while the map explains its missing tile key.

Never commit `.env` or paste keys into chat. Domain restrictions do not make a browser key secret. Provider credentials and query parameters are excluded from application logs.

## How it works

| Component | Responsibility |
| --- | --- |
| `backend\trips\providers\tomtom.py` | Fixed-host HTTP adapter, normalized location/route data, real facility search, bounded requests and safe provider errors. No response caching. |
| `backend\trips\services\planner.py` | Route-aware facility selection, detours, bounded backtracking and the final accepted itinerary. |
| `backend\trips\domain` | Typed activities, pure HOS state, independent replay validation, log splitting and assumption configuration. |
| `backend\trips\api` | Signed location/planning context, input validation, anonymous CSRF protection and request throttling. |
| `frontend\src` | Four-input interface, map, summaries, stop timeline/directions and SVG daily log sheets. |
| `Project guide` | Original assessment and reference resources, preserved unchanged. |

The server signs selected location data: a browser cannot silently replace it with arbitrary coordinates. Every generated result uses a single accepted activity timeline. Its route, stops, summaries and daily logs are derived from that timeline rather than independently calculated in the browser.

The planner searches for a real facility **before** a driving/fuel limit, routes to it, includes the detour, and checks the resulting schedule. A point interpolated along the route is only a search center, never a fabricated stop. If the available data and bounded search cannot produce a complete valid plan, the API returns an explicit error.

## Assumptions and limits

| Topic | Implemented assessment model |
| --- | --- |
| Geography | Contiguous US only; no border crossings, ferries, train or non-truck legs. |
| Departure | 08:00 on the date shown before submission. Fixed `UTC-06:00` throughout; no daylight-saving or browser-timezone adjustments. |
| Initial shift | At least 10 hours off before the first work activity. Cycle usage is still carried forward. |
| Driving limits | 11 driving hours within a 14-consecutive-hour window; 30 consecutive non-driving minutes before exceeding 8 cumulative driving hours. |
| Work | Pickup/drop-off each take one hour on duty. Fueling is 30 minutes on duty. These can satisfy the driving-break requirement, but are not off-duty rest. |
| Daily rest | 10 consecutive hours in the sleeper-berth row; 34-hour restarts also use that row. Ordinary 30-minute breaks remain off duty. No split-sleeper optimization. |
| Cycle | Initial usage plus driving/on-duty work. No invented rolling daily recapture. Use a 34-hour off-duty restart when more cycle capacity is needed. |
| Cycle input | 0 through 192 hours, the physical maximum in eight days. Values at/above 70 require a restart before driving, not rejection of otherwise lawful non-driving work. Fractional usage rounds up to whole seconds. |
| Fuel | Start full; maximum 1,000 routed miles between refueling, including detours. Earlier refueling is allowed. |
| Facilities | Real mapped fuel/rest/service areas, assumed usable whenever needed. No parking, opening-hour, fuel-stock or stay-permission checks. Supplied trip locations can also be used for rests. |
| Routing | Provider travel estimates and generic truck settings, without vehicle dimensions/weight or live traffic replanning. |
| Logs | Fixed 24-hour sheets. Outside-trip periods are explicitly assumed off duty. Unknown driver/carrier/vehicle/shipping/signature fields remain `Not provided`; historic recap remains unavailable. |
| Mileage | Estimated provider route progress, interpolated across midnight as needed, not actual vehicle telemetry. |

The 34-hour restart is a **conservative chosen strategy**, not a claim that a restart is always mandatory under the actual rolling-cycle rules. Midnight never resets a driving shift. Non-driving work can continue after a driving limit, so the planner does not insert a pointless rest before final unloading.

Configurable guardrails in `backend\.env`:

| Variable | Default | Reason |
| --- | --- | --- |
| `PLAN_MAX_DAYS` | 30 calendar days | Bounds long restart-heavy plans and log rendering. |
| `PLAN_MAX_FACILITIES` | 100 inserted visits | Prevents runaway stop insertion. |
| `PLAN_MAX_REQUESTS` | 100 outbound requests per generation | Bounds searches, candidate routes and retries; all count. |
| `PLAN_TIMEOUT_SECONDS` | 120 seconds | Application deadline: cancels pending HTTP waits and rejects expired results. |

The first exhausted limit stops planning with an error; partial results are not presented as successful. Location lookup and browser tile requests are separate from the trip budget. Local API throttles allow 6 generation requests and 30 lookup/bootstrap requests per minute per direct client IP, with two active planners and four active provider connections.

Provider responses are not cached; repeated calls count against the request budget. The adapter requests uncompressed JSON and rejects unexpected compression or bodies above eight megabytes before accumulation. API errors use a safe JSON envelope with a request ID, including during local DEBUG development.

These in-process controls are for a single local assessment instance, not distributed production abuse protection. The timeout is an application guardrail, not an operating-system execution cutoff. No raw addresses or itineraries are persisted; transient request data and signed browser-held selections exist only to calculate the trip. Canceling a browser request does not cancel server-side work; the application deadline still applies.

## Checks

From `backend` with `.env` configured for local development:

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py test trips.tests
```

From `frontend`:

```powershell
npm run format:check
npm run lint
npm test
npm run build
```

Use `npm run format` to apply the shared frontend formatting style. Linting checks TypeScript and React Hooks; successful API payloads are also validated at runtime before the interface renders them.

Automated scenarios use authored provider fixtures with no live network or keys. Live verification additionally requires searching three real locations and generating a short trip, a multi-day trip, and a high-cycle trip using the configured TomTom account. Do not confuse fixture coverage with verified provider entitlement or live facility data.
