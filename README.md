# Meridian 5.0 — Coolify edition

This is a deployable Vue 3 / TypeScript / Vite + AG Grid Community + FastAPI application, with Redis snapshots and PostgreSQL user settings. It implements the attached Chinese desktop-terminal brief using original code and branding.

**Deployment target:** a Docker host managed by Coolify. This is a separate deployment from the existing 4.4.1 Cloudflare Worker. A `workers.dev` address cannot run this four-container stack. Do not paste these Python/Vue sources into the Cloudflare code editor. The previous Worker, its URL, settings and variables are unchanged.

## Publish through Coolify, from Git (recommended)

1. Extract `meridian-coolify-source.zip`. Upload the **contents** of `meridian-coolify/` to the root of your own Git repository. The root must contain `frontend/`, `backend/`, `scripts/`, and `docker-compose.yml`.
2. In Coolify, open your project/environment and choose **New Resource → Application**, connect that repository and select **Docker Compose** as the build pack. Use base directory `/` and Compose file `/docker-compose.yml`. For the complete Meridian source archive instead, use base directory `/deploy/coolify` and the Compose file in that directory. Coolify labels may vary by version.
3. Set these resource **runtime environment variables** before deploying:

   | Variable | Value |
   | --- | --- |
   | `POSTGRES_PASSWORD` | A strong private database password. Retain it for later deployments. |
   | `MERIDIAN_AUTH_DIGEST` | Existing terminal digest copied from the current Worker's settings, or SHA-256 hex of your UTF-8 `username:password`. Exactly 64 hexadecimal characters. |
   | `DATA_PRIMARY` | `akshare` |
   | `DATA_FALLBACK_CHAIN` | `akshare,tushare` |
   | `TUSHARE_TOKEN` | Optional. Leave blank to use the default free public sources. Availability/permissions depend on the Tushare account. |
   | `SNAPSHOT_INTERVAL_SECONDS` | `10` (valid range 5–300) |
   | `PROVIDER_TIMEOUT_SECONDS` | `35` (valid range 5–120) |
   | `BROKER_MODE` | `paper` |
   | `REALTIME_PROVIDER` | Blank. The live tick-provider hook is inactive. |

4. Assign your HTTPS domain to the **frontend** service, internal port **80**. Expose only that service through the Coolify proxy. PostgreSQL, Redis and backend ports stay inside the stack. Configure a health check at `/healthz`; the homepage intentionally returns a login challenge.
5. Select **Deploy**. Coolify builds the Vue frontend and Python backend, starts PostgreSQL/Redis, initializes the schema and 5,000-symbol directory, then starts the frontend after the backend is healthy. Initial image builds can take several minutes.
6. Open `https://YOUR-DOMAIN/healthz`. Expect `{"status":"ok","version":"5.0.0"}`. Then open the domain and use the **terminal** username/password. Your Cloudflare, Google or Coolify account password is not the terminal password.

No local website needs to run. The default Compose file intentionally has no host `ports:` mappings: Coolify supplies domain routing.

### Generate a new terminal digest, if needed

Run `python scripts/setup.py` or, on Windows, `py scripts/setup.py`. This is a **configuration-only** command: it asks for a terminal username and password, then writes a private `.env` containing the digest and a random PostgreSQL password. Copy those values into Coolify's environment-variable form. It does not start a website. Existing `.env` files are retained. Never upload the generated `.env` to Git.

If reusing the previous terminal login, copy `MERIDIAN_AUTH_DIGEST` directly from your own Cloudflare settings instead; no password reset is necessary.

## Coolify “Docker Compose Empty” route

A pasted Compose file cannot read source folders from your computer. For this route, first put the extracted project contents at the root of a **public Git repository**, then:

1. Create **New Resource → Docker Compose Empty**.
2. Paste **`docker-compose.coolify-empty.yml`**, which uses remote Git build contexts.
3. Set `SOURCE_REPOSITORY_URL` to the repository URL ending in `.git`, and `SOURCE_GIT_REF` to your branch or pinned commit (default `main`), plus the runtime variables above.
4. Assign the frontend HTTPS domain/internal port 80 and choose **Deploy**.

For a private repository, use Coolify's Git integration and the recommended route, rather than embedding access tokens in a repository URL. Both Compose files describe the same four services.

## Implemented desktop workflow

- White/light-gray, 12px interface; rectangular toolbar/tabs, borders, 240px collapsible function tree, dense sortable tables, frozen columns and CSV export. Gains/losses use red/green numerical text. No black/amber terminal skin, cards or shadows.
- `.` opens a custom 280px keyboard wizard near the pointer. Search accepts ticker, Chinese name or Pinyin initials. Arrow keys select, Enter opens F5 and selects the security; Esc closes the wizard or returns to the previous view. F5 and F9 prevent browser-default actions.
- F5 filters code/name, source-enriched industry, P/E, market capitalization and percentage change. Missing numeric values never pass numeric bounds. Source industry is enriched after a successful F9 company-profile request; **bulk industry classification is not prepopulated**.
- F9 has company overview, financial data, announcements, shareholder structure and news tabs. Daily candlesticks, A-share five-minute bars where available, MA5/20/60, RSI14, MACD, BOLL and ATR use validated observed OHLC data. ETF NAV is shown as NAV, separately from trading prices. Shareholder report date and announcement publication date are explicit inputs.
- EDB has GDP/CPI/PMI/money/rates/import/export indicators, a source table and a plain line chart. Missing observations are omitted, not replaced with zero.
- News can be docked at the bottom or right, hidden, or opened as the main view. Source summaries and links are rendered as plain text/safe HTTP links. Public research directories do not imply unrestricted full-text access.
- Workspaces, screening presets, grouped watchlists and mutation audit logs persist in PostgreSQL. CSV export and the custom right-click menu use AG Grid Community; no Enterprise license is needed.
- Authenticated REST/OpenAPI documentation is at `/api/docs`.

## Coverage and source behavior

The bundled directory contains **5,000 unique configured symbols: 4,800 equities (including two Hong Kong securities), 180 ETFs and 20 indices**. Configuration is not a guarantee that every symbol has a fresh quote at once.

| Module | Primary / supplementary source | Meaning and limits |
| --- | --- | --- |
| A shares, HK stocks, ETFs, indices | AkShare public snapshots; bounded Tencent public batch supplement | Broad fallback scans rotate batches and merge observations with their original per-row retrieval times. Partial coverage and stale rows are labelled. A selected configured symbol/watchlist uses direct bounded requests. |
| Daily price history | AkShare Eastmoney; AkShare Tencent daily fallback | Unadjusted OHLC; dividends are excluded. Invalid candles are rejected. Intraday is A-share only in this edition. |
| Company / financials | AkShare Eastmoney, Cninfo company profile and Sina statements | Latest available/revised disclosures; not a point-in-time archive. Unsupported asset fundamentals remain unavailable. |
| Futures | AkShare Sina domestic contracts | Default `RB0,AU0,CU0,IF0`; zero-suffix instruments are continuous series, not executable contracts. |
| Options | AkShare Eastmoney contract quotes | If unavailable, SSE contract-directory fallback is explicitly labelled **without current prices**. Not every option has daily bars. |
| Bonds | AkShare ChinaBond yield curves | Published daily yields; not a universal bond tick feed. |
| FX | AkShare Eastmoney; China Foreign Exchange Trade System bid/ask fallback | Original bid/ask fields retained; no fabricated last-trade price. |
| Open-end fund NAV / holdings | AkShare Tiantian Fund | Published NAV and disclosed portfolio data; not intraday values. |
| Macro / news / research | AkShare public statistical/news/report sources | Source cadence varies; news cache is 60 seconds, macro 1 hour. |
| Optional Tushare | Daily history / latest trading-day close fallback | Requires token and account permissions; daily close is never presented as a real-time quote or used for real-time paper fills. |

The background scheduler is integrated into the single backend worker. It refreshes A-share snapshots, then waits the configured interval; auxiliary market scans rotate less frequently. The foreground polls while visible. **Polling interval is not an exchange-latency guarantee.** Initial source retrievals can take longer, particularly when the primary provider fails.

Calls run in disposable, timeout-bounded processes with at most two concurrent provider jobs. Requests for the same cache key coalesce; failed refreshes retain the original data timestamps and use a retry cooldown. Tencent supplementary batches have a separate bounded pool. No synthetic production quotes are included.

The OpenBB international layer is not enabled in the default image. This release does not claim full Wind parity, proprietary news access, universal tick data, an Excel add-in, or licensed data entitlements.

## Paper trading and extension boundaries

`BrokerAdapter` defines `preview_order()`, `submit_order()`, `cancel_order()` and `get_positions()`.

The default `PaperBrokerAdapter` uses CNY 1,000,000 of simulated cash, configured A-share stocks, integer 100-share lots, market/limit orders and a simulated 0.03% fee. Previews expire after 30 seconds. Submission is idempotent for the same preview. Resting limit orders reserve funds/stock and can be cancelled; completed fills cannot. Stale or missing quotes and daily-close fallback quotes are rejected for simulated real-time matching.

**Paper accounts are in memory and reset on backend restart.** They do not model exchange order books, actual execution, T+1, all fees/taxes or price limits. Use exactly one backend process; horizontal scaling needs a durable matching service first.

`QMTAdapter` and `PTradeAdapter` are explicit `NotImplementedError` boundaries. Choosing their modes does not enable live trading. `REALTIME_PROVIDER` records intended configuration but has no active licensed tick adapter. No real orders are sent.

## Verify after publishing

Check the health endpoint, sign in, search `gzmt`, press Enter, open F9, inspect the source timestamps, open EDB, save/load a workspace and add/remove a watchlist item. Preview a paper order only if you want a simulated order; submitting requires a separate explicit confirmation.

Optional read-only verification:

```text
python scripts/verify_live.py https://YOUR-DOMAIN
```

This checks the published version, private access, directory and source response. It never submits orders. A healthy application with an unavailable provider is reported separately.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Compose reports missing variable | Set both required variables before Deploy; do not paste an empty example value. |
| Build cannot find Dockerfile or package-lock | Check repository root/base directory. For Compose Empty, use the remote-context Compose file and a reachable repository. |
| 401 / browser login prompt | Use terminal credentials corresponding to the configured digest. |
| Backend never becomes healthy | Inspect backend, PostgreSQL and Redis logs. Keep the database password unchanged after initialization; changing only its environment variable does not reset an existing PostgreSQL user's password. |
| Frontend 502 / no available server | Route to frontend:80 and inspect dependency health; do not route the public domain to Redis/PostgreSQL. |
| One data panel unavailable / partially covered | Check its source state and timestamps. A source outage is not repaired by repeatedly redeploying the UI. |
| Existing preferences disappeared | Verify you retained the same PostgreSQL volume; do not delete persistent volumes during an upgrade. |

Recommend a Linux x86-64 Docker host with at least 2 vCPU/4GB RAM for builds and provider processes. Package versions are locked; use `npm ci` and the supplied Python constraints. An existing free Workers plan does not provide this Docker host.

## Validation scope

`checks/` contains actual public-source attempts and the release check summary. Successful HTTP source retrievals do not prove availability from your future Coolify server or exchange-event latency. The editing environment has no Docker daemon and no supplied Coolify server/credentials: image startup, PostgreSQL/Redis together, proxy behavior and the final hosted URL must be verified after deployment. No local website server was started.

The automated checks run the frontend production build, real AG Grid Community DOM interaction, keyboard/workspace/paper UI workflows, in-process FastAPI workflows, source normalization, stale-cache handling, child-process cleanup, indicator warmups and paper matching. They do not guarantee zero future bugs.

Official references: [Coolify Compose](https://coolify.io/docs/applications/builds/docker-compose), [AG Grid Community export](https://www.ag-grid.com/vue-data-grid/csv-export/), [AkShare documentation](https://akshare.akfamily.xyz/), [Tushare](https://tushare.pro/document/2).
