# Deployment

Two managed services, one repository:

| Tier | Platform | URL |
| --- | --- | --- |
| Frontend | Vercel | `https://trust-rag-agent-fullstack.vercel.app` |
| Backend | Render | `https://trustrag-api-glcf.onrender.com` |

Local development does not require Docker. Docker Compose remains available for
a single-command local stack.

## 1. Backend on Render

### Service settings

| Setting | Value |
| --- | --- |
| Environment | Docker |
| Root directory | `backend` |
| Dockerfile | `backend/Dockerfile` |
| Health check path | `/api/health` |
| Instance | Free tier is supported but sleeps |

The container runs `alembic upgrade head` and then Uvicorn on `${PORT}` with
proxy headers. It runs as a non-root `trustrag` user.

### Required environment variables

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Render PostgreSQL URL. `postgres://` and `postgresql://` are normalised to `postgresql+asyncpg://` automatically. |
| `GOOGLE_API_KEY` | Server-side only. Omit to run in labelled offline extractive mode. |
| `ENVIRONMENT` | `production` |
| `CORS_ORIGINS` | Comma-separated explicit origins, e.g. the Vercel domain |
| `CORS_ORIGIN_REGEX` | Default `https://([a-z0-9-]+\.)*vercel\.app` covers previews |
| `GEMINI_MODELS` | Default `gemini-3.5-flash-lite,gemini-3.8-flash` |
| `AUTO_CREATE_SCHEMA` | Keep `false`; Alembic owns the schema |
| `SEED_MITRE` | `true` seeds the ATT&CK catalog idempotently |

Never commit `.env`. `backend/.env.example` and the root `.env.example` contain
placeholders only.

### Verify

```bash
curl -s https://trustrag-api-glcf.onrender.com/api/health
# {"status":"ok","database":"ok",...}
```

## 2. Frontend on Vercel

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |

`frontend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://trustrag-api-glcf.onrender.com/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- The first rule proxies every API call to the exact Render service.
- The second rule is the SPA fallback so `/evaluation` and other client routes
  survive a hard refresh.
- Leave `VITE_API_BASE_URL` **unset** in Vercel. The bundle then calls
  same-origin `/api`, which the rewrite proxies server-side.

### The 502 failure mode

Two distinct causes have produced `502` at the Vercel edge:

1. **Wrong Render hostname.** Render assigns a service-specific subdomain
   (`trustrag-api-glcf.onrender.com`). The generic
   `trustrag-api.onrender.com` resolves through Render's wildcard DNS but has
   no service behind it and returns `404`/`502`. Copy the public URL from the
   Render dashboard → service → **Settings → Public URL**.
2. **Free-tier cold start.** Render sleeps after ~15 minutes of inactivity. The
   first request can take ~40–45 seconds; Vercel's proxy may time out before
   Render responds. A retry succeeds once the service is warm. Render's own
   health check does not prevent spin-down.

Mitigation for (2): point an external uptime monitor at
`https://<render-service>.onrender.com/api/health` every 5–10 minutes, or move
to a paid instance that does not sleep. No frontend change can extend Vercel's
upstream timeout.

### Verify

```bash
curl -s https://trust-rag-agent-fullstack.vercel.app/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://trust-rag-agent-fullstack.vercel.app/evaluation
curl -s -o /dev/null -w '%{http_code}\n' https://trust-rag-agent-fullstack.vercel.app/
```

Expected: `200` JSON for the first, `200` HTML for the other two.

## 3. CORS

Normal UI traffic is same-origin through the rewrite, so CORS is not exercised.
It matters for direct browser calls and preview deployments:

- explicit origins from `CORS_ORIGINS`;
- `localhost:5173` and `127.0.0.1:5173` always allowed for development;
- `CORS_ORIGIN_REGEX` covers `*.vercel.app`.

Preflight check:

```bash
curl -s -i -X OPTIONS https://trustrag-api-glcf.onrender.com/api/health \
  -H 'Origin: https://trust-rag-agent-fullstack.vercel.app' \
  -H 'Access-Control-Request-Method: GET'
```

## 4. Release checklist

1. `cd backend && pytest -q`
2. `cd frontend && npm run typecheck && npm test && npm run build`
3. Push to `main`; Vercel auto-deploys, Render redeploys when configured.
4. Confirm Render logs show `alembic upgrade head` success and
   `Application startup complete`.
5. Run the verification commands above.
6. Open the dashboard and confirm the badge reads `API ONLINE` with no console
   errors.

## 5. Rollback

- **Frontend:** promote the previous Vercel deployment (instant, no rebuild).
- **Backend:** redeploy the previous Render image/commit. If the last release
  included a migration, run `alembic downgrade -1` only after confirming the
  migration's `downgrade()` is safe and taking a database backup.
- **Config:** rewrite changes take effect on the next deployment; revert the
  commit and redeploy.

## 6. Local production-like run

```bash
# backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000

# frontend
cd frontend
npm ci
npm run dev                     # proxies /api to 127.0.0.1:8000
```

Optional full stack:

```bash
docker compose up --build
```

Docker is optional, not required for development or tests.
