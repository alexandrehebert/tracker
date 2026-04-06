# OpenSky proxy for Scaleway Functions

This folder contains a lightweight HTTP proxy function for OpenSky that can be deployed to **Scaleway Serverless Functions**.

## Required environment variables

- `OPENSKY_CLIENT_ID`
- `OPENSKY_CLIENT_SECRET`
- `OPENSKY_PROXY_SECRET` (recommended)
- `OPENSKY_PROXY_UPSTREAM_TIMEOUT_MS` (optional, default `12000`)

## Expected handler

Use:

```text
handler.handler
```

## Supported routes

- `GET /health`
- `POST /auth/realms/opensky-network/protocol/openid-connect/token`
- `GET /api/*`

## Deploy steps (Scaleway console)

1. Create a **Serverless Functions namespace** in a European region such as `fr-par`.
2. Create a **Node.js 20** function.
3. Upload the contents of this folder.
4. Set the handler to `handler.handler`.
5. Add the environment variables above.
6. Expose the function publicly.

Then point the main app at the function URL:

```env
OPENSKY_PROXY_URL=https://<your-function-url>
OPENSKY_PROXY_SECRET=<same-shared-secret>
```

## Quick test

```bash
curl -H "x-opensky-proxy-secret: <your-secret>" https://<your-function-url>/health
```
