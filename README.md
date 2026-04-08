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

### Optional schedule-validation providers

- `RAPIDAPI_AERODATABOX_API_KEY` enables the quota-aware AeroDataBox lookup for the per-flight `Validate flight` action on `/[locale]/chantal/config`.
- The bulk `Validate flights` action intentionally skips AeroDataBox so low-volume plans (for example `1 req/s`, `300 calls/month`) are only consumed on explicit clicks.
- `AERODATABOX_MIN_REQUEST_GAP_MS` defaults to `1200` to stay under a `1 call / second` cap, and `AERODATABOX_CACHE_TTL_SECONDS` defaults to `43200` (12h) to reduce repeated lookups.

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

### External OpenSky proxy for Vercel

If direct calls from Vercel to OpenSky time out in production, the app now supports routing those requests through a small external relay.

#### 1) Run the relay outside Vercel

You can deploy the included proxy on any small Node/Docker host close to Europe:

```bash
docker build -f docker/Dockerfile.opensky-proxy -t opensky-proxy .
docker run --rm -p 8787:8787 \
  -e OPENSKY_CLIENT_ID=your-opensky-client-id \
  -e OPENSKY_CLIENT_SECRET=your-opensky-client-secret \
  -e OPENSKY_PROXY_SECRET=choose-a-long-random-secret \
  opensky-proxy
```

Or run it directly with:

```bash
OPENSKY_CLIENT_ID=... \
OPENSKY_CLIENT_SECRET=... \
OPENSKY_PROXY_SECRET=... \
npm run start:opensky-proxy
```

Health check:

```bash
curl http://localhost:8787/health
```

#### 2) Point the Vercel app at the relay

Set these environment variables on Vercel:

```bash
OPENSKY_PROXY_URL=https://your-proxy-host.example.com
OPENSKY_PROXY_SECRET=choose-a-long-random-secret
```

Once `OPENSKY_PROXY_URL` is set, the app sends OpenSky auth and API traffic through that relay instead of calling OpenSky directly from the Vercel function.

#### Scaleway Serverless Functions option

A Scaleway-ready function is included in `scaleway/opensky-proxy/`.

- runtime: **Node.js 20**
- handler: `handler.handler`
- recommended region: `fr-par`

After deployment, set:

```bash
OPENSKY_PROXY_URL=https://<your-scaleway-function-url>
OPENSKY_PROXY_SECRET=choose-a-long-random-secret
```

Then verify with:

```bash
curl -H "x-opensky-proxy-secret: <your-secret>" https://<your-scaleway-function-url>/health
```
