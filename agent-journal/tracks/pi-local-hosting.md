# Raspberry Pi local hosting

## 2026-08-02

- Confirmed the host is a Raspberry Pi 5-class aarch64 system (`pi1`) with 15 GiB RAM and sufficient free disk space.
- Confirmed Tailscale is connected. The Pi's tailnet IPv4 address is `100.120.3.88`; `logans-macbook-pro` was active on the same tailnet during verification.
- Found the Next.js application under `web/`. It declares Node 24 in `package.json` and `.nvmrc`, while the Pi currently has Node `v22.23.1` and npm `10.9.8`.
- Ran `npm ci` in `web/`. Installation and Prisma Client generation succeeded on Node 22 with an engine-version warning. npm reported 14 dependency vulnerabilities (3 moderate, 9 high, 2 critical); no automatic dependency mutations were made.
- Started the development server with `npm run dev -- --hostname 0.0.0.0`. Next.js 16.2.9 became ready on port 3000.
- Verified `GET /` returns HTTP 200 through both `http://127.0.0.1:3000/` and `http://100.120.3.88:3000/`. The response title is `Roblox AI Clothing Generator – 2D Roblox Shirt Maker`.
- Verified the process is listening on `0.0.0.0:3000`, so the site is reachable over Tailscale at `http://100.120.3.88:3000/` while the current development process remains running.
- `GET /api/credits` returns HTTP 500 because `DATABASE_URL` is not configured. No `.env` or `.env.local` exists in `web/`. Authentication, Stripe, and inference routes also lack their service credentials/endpoint URLs, so the UI is hosted but those integrated features are not expected to work yet.
- Next step for durable hosting: supply the real environment configuration, use Node 24, run a production build, and install a boot-managed service. Do not commit credentials.
