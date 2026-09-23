# Spotter frontend

React + TypeScript + Vite, native CSS, and direct Leaflet. Runtime dependencies are limited to React, React DOM, and Leaflet. Dependencies are pinned and `package-lock.json` is committed-ready.

## Local development

Use Node 24.7+ and npm 11.5+.

```powershell
Set-Location Q:\Repos\Spotter\frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Open the Vite address on `127.0.0.1` or `localhost`. Run the Django backend separately at `http://127.0.0.1:8000`. Both dev and preview proxy `/api` without changing the host. API requests are relative, include same-origin credentials, and send the bootstrap CSRF token on trip POSTs. Do not bypass CSRF with CORS or expose backend credentials through `VITE_` variables.

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run preview
```

Use `npm run format` after editing to apply the shared Prettier style. ESLint checks TypeScript and the Rules of Hooks, including effect dependencies. The build still performs its own typecheck; lint and formatting are explicit checks rather than hidden build-time rewrites.

No frontend environment file is needed. Set the separate, restricted **public** TomTom raster-map key on the backend; the bootstrap response supplies it to the browser. Browser-visible map keys must have appropriate product and allowed-origin restrictions. The frontend only constructs tile URLs under `https://api.tomtom.com/map/1/tile/basic/main/`. It never receives or uses the server credential. No tiles are requested without a syntactically valid public key.

## Vercel deployment

The repository root `vercel.json` deploys this directory as the Vite service
and routes `/api/*` to the sibling Django service on the same Vercel hostname.
No frontend API-base environment variable or CORS configuration is required.
Vercel runs `npm ci`, `npm run build` and serves `dist`.

Configure deployment secrets and both TomTom keys on the Vercel project, not in
this directory. The public map key is returned by Django at runtime and should
be restricted to Map Display plus the approved production domain. See the root
README for dashboard, firewall and smoke-test instructions.

## Flow and boundaries

- Four required inputs: current location, pickup, drop-off, and finite current cycle hours from 0 through 192 (the physical maximum across eight days). Search is explicit; the user selects a signed result. Editing text immediately invalidates that selection. Values from 70 through 192 are accepted and disclose the planned restart. Both frontend and backend validate the 192-hour upper bound.
- Bootstrap freezes the displayed planning context: 08:00 in fixed UTC−06:00. All schedule and sheet dates use that same basis, regardless of browser timezone or daylight saving.
- The server owns route, facility, HOS, and log calculations. The UI converts meters to miles using 1609.344 and preserves seconds in detailed durations and grid positions. It does not fabricate routes, stops, estimates, or fallback results.
- Editing inputs, cancelling planning, refreshing context, or unmounting aborts obsolete browser requests. Version guards also discard late responses. Duplicate trip submissions are prevented. A failed request preserves entered and selected inputs. Backend planning is synchronous, so abandoned work continues until completion, failure, or its deadline.
- Successful API responses are checked at runtime before entering React state. Invalid structures use the normal recoverable request-error UI rather than relying on TypeScript assertions.
- Keyboard navigation keeps the active lookup result visible by scrolling only the result list; focus stays in the search input. Form validation and submission are kept in a named typed handler rather than embedded in JSX.
- TomTom tile failures do not discard a successful itinerary or logs. Stop selections synchronize map markers and the ordered itinerary by stop ID. All provider content is rendered as text; Leaflet popups use DOM text nodes.
- Log sheets are rebuilt as HTML/SVG, not image backgrounds. Four duty rows, 24 hours, quarter-hour guides, exact transitions, totals, remarks, navigation, and a text table are included. Assumed day-boundary off-duty time is dashed. Unknown identity, carrier, vehicle, shipping, and signature fields remain “Not provided”; historical recap and next-day recapture remain unavailable.

## Explicit limitations

These are projected assessment plans, not certified ELD records or live navigation. Generic truck routing does not verify clearance for a particular vehicle. Actual provider-listed facilities are assumed usable at any time; opening hours, parking, overnight permission, and fuel availability are not verified. The model uses full daily rests and conservative cycle restarts, not split-sleeper optimization or inferred daily history. The backend supplies versioned assumption IDs and numerical caps; frontend-owned copy renders the corresponding disclosures.

No accounts, saved trips, analytics, demo mode, PDF export, alternate map provider, or paid service setup is included. Vercel deployment configuration is included, but creating the cloud project, configuring credentials/domains/firewall rules and performing the live deployment remain operator actions. Live routing verification requires configured TomTom credentials. Tests use authored API fixtures only, never runtime fallback data.
