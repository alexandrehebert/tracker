# Flight Tracker

Standalone Next.js app for live aircraft tracking on an interactive world map, built on the shared map stack and wired to OpenSky data.

## Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS v4
- next-intl (`en`, `fr`)
- Vitest + Testing Library

## Run locally

```bash
docker compose up --build
```

Open `http://localhost:4109`.

This starts the app locally with Docker Compose in development mode (`next dev`) with auto-reload.
It also starts a small `tracker-cron` sidecar that calls `/api/tracker/cron` automatically every 15 minutes so the Mongo-backed flight cache stays warm locally too.

If you explicitly need a non-Docker workflow for local development:

```bash
npm install
npm run dev
```

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

### Local cron automation

- The `tracker-cron` service waits for the app to become healthy, then triggers `http://tracker:4109/api/tracker/cron` every `900` seconds by default.
- Override the cadence with `TRACKER_CRON_INTERVAL_SECONDS` in your `.env`.
- If you set `CRON_SECRET`, the cron sidecar automatically sends `Authorization: Bearer $CRON_SECRET`.

## Deploy

This project is self-contained and can be deployed independently as a standard Next.js app.
