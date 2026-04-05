# Flight Tracker

Standalone Next.js app for live aircraft tracking on an interactive world map, built on the shared map stack and wired to OpenSky data.

## Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS v4
- next-intl (`en`, `fr`)
- Vitest + Testing Library

## Run locally

### Configuration

Create a local env file before starting the app:

```bash
cp .env.example .env.local
```

Then set:

```bash
OPENSKY_CLIENT_ID=your-client-id
OPENSKY_CLIENT_SECRET=your-client-secret
AVIATION_STACK_API_KEY=
FLIGHT_AWARE_API_KEY=
ENABLED_API_PROVIDERS=opensky,flightaware,aviationstack
MONGODB_URI=mongodb://localhost:27017/tracker
MONGODB_DB_NAME=tracker
OPENSKY_CACHE_TTL_SECONDS=300
```

The app now reads OpenSky credentials from environment variables instead of `credentials.json`. FlightAware accepts `FLIGHT_AWARE_API_KEY` as the primary env name, while the legacy `FLIGHTAWARE_API_KEY` alias still works. Flight search responses are cached in MongoDB for 5 minutes by default, while the UI still refreshes every 60 seconds.

To feature-flag providers, set `ENABLED_API_PROVIDERS` to a comma-separated allowlist such as `opensky` or `opensky,flightaware`. You can also use `DISABLED_API_PROVIDERS` or the per-provider overrides `OPENSKY_DISABLED`, `FLIGHTAWARE_DISABLED`, and `AVIATIONSTACK_DISABLED` for quick local toggles.

### Docker

```bash
docker compose up --build
```

Open `http://localhost:4109`.

This starts the app locally with Docker Compose in development mode (`next dev`) with auto-reload, alongside a local MongoDB instance used for the OpenSky cache.

If you explicitly need a non-Docker workflow for local development:

```bash
npm install
npm run dev
```

Then open `http://localhost:4109`.

## PWA

The app now ships with a web app manifest, installable icons, and a service worker-backed offline fallback.

For a realistic installability check, use the production build:

```bash
npm run build
npm run start
```

Then open `http://localhost:4109`, inspect the Application tab in DevTools, and verify the manifest and service worker are active.

Installability notes:

- PWA installation requires `localhost` or `https`.
- The service worker is registered only in production builds.
- When you switch back to `npm run dev`, any old service worker on the same origin is unregistered automatically to avoid stale caches during development.

## Build

```bash
npm run build
npm run start
```

## Docker (local)

```bash
docker compose up --build
```

Then open `http://localhost:4109`.

This runs the development server with source mounted for hot reload.

## Deploy

This project is self-contained and can be deployed independently as a standard Next.js app.
