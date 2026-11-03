# Meridian Research Platform · v6

Public research pages, accounts, private notes, supporting files, search and a focused market watchlist. Vue and the API live in this repository. Cloudflare Workers serves the app, D1 stores relational data, and R2 stores file bytes. There are no containers, long-running backend services or market-streaming processes.

**Production target:** https://meridian-research-terminal.cooked-jersey.workers.dev/

This is the intended deployment target, not evidence that this release has been published. A successful GitHub deployment runs read-only checks against that URL. Builds with missing Cloudflare credentials explicitly skip publishing and leave the existing Worker unchanged.

## What the product does

- Pre-renders the public home and product guide; loads published member research through the API.
- Registers accounts and signs users in with opaque, server-side sessions. Supports logout, display-name changes and password changes.
- Creates, edits, searches and deletes private notes; publishes selected notes explicitly. Version checks prevent one tab silently overwriting another.
- Uploads private PNG, JPEG, WebP and PDF files to R2. Owners can publish a file, make it private again or delete it.
- Searches public notes or the signed-in user's own notes with D1 FTS5.
- Searches 5,000 configured securities, saves an account's watchlist and fetches bounded public quote snapshots. Optional 60-second polling runs only while the watchlist page is visible.

Every private read and write is checked on the server. The UI does not supply trusted owner IDs. Public notes are rendered as text, not executable HTML.

## Publish from GitHub

Save **one GitHub repository secret, `CLOUDFLARE_API_TOKEN`**, with the account permissions in **[DEPLOY.md](DEPLOY.md)**. Then run **Check and deploy Meridian** from the Actions tab. The workflow discovers the account, prepares D1/R2/Turnstile, generates a missing app secret and publishes to the existing Worker. R2 must already be enabled in the account. No other repository variables or keys are required.

Future pushes to `main` deploy with the same authorization. The workflow installs locked dependencies, checks types, runs API and interface tests, builds public pages, preserves existing target/settings and app secrets, inspects existing data, applies migrations, deploys and verifies the live release. Pull requests run checks without deploying. Unsupported legacy schemas/bindings stop for a deliberate migration; no existing database is reset or replaced.

## Repository

| Path | Purpose |
| --- | --- |
| `src/web/` | Vue app, public routes and signed-in workspace |
| `content/pages.json` | Public page content used by the app and pre-renderer |
| `src/api/` | Workers API, account/session logic, permissions and quote adapter |
| `src/api/catalogue.json` | 5,000 UTF-8 security names and configured public quote codes |
| `migrations/` | D1 schema and full-text search triggers |
| `public/_headers` | Static asset cache and browser security policies |
| `scripts/` | Pre-rendering, guarded deployment and live verification |
| `tests/` | Cloudflare-runtime API tests and Vue/deployment tests |
| `.github/workflows/cloudflare.yml` | Checks and deployment on pushes to `main` |

## Development and checks

Use Node 24 and npm. These are optional instructions for developers; deployment through GitHub does not require a locally running website.

```sh
npm ci
npm run check
npm test
npm run build
npm run build:worker
```

The Worker dry run bundles code without publishing. API tests use an isolated Cloudflare runtime with local D1/R2 and mocked external quote/Turnstile replies; they do not create accounts in production or prove availability of an external provider.

For optional local development:

```sh
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Open `http://localhost:8787` when running that optional development command. Local D1 and R2 persist under `.wrangler/`, independently of production. Official Turnstile test keys are accepted only for development on localhost/127.0.0.1 and are rejected in production. Session cookies are always Secure; use a browser that treats localhost as trustworthy, or configure local HTTPS and set `PUBLIC_ORIGIN` to the matching HTTPS origin. Keep `.dev.vars` untracked. Rebuild after editing frontend files; this simple development command serves the compiled frontend rather than a second Vite server.

## Data, limits and cache policy

| Resource | Policy |
| --- | --- |
| Notes | Up to 100 per account; title 160 characters, body 10,000; private by default |
| Files | 2 MiB per file, 20 MiB and 50 files per account; metadata in D1, bytes in R2 |
| Watchlist | Up to 50 saved symbols; at most 20 requested quotes at once |
| Source | Tencent public web quotes, fetched only on request; no upstream service or latency guarantee |
| Static pages | Served through Workers Static Assets; browsers revalidate HTML |
| Hashed JS/CSS | Long-lived immutable caching |
| API and errors | `Cache-Control: no-store, private`, including authenticated and public search/content APIs |
| Private files and PDFs | No-store; PDFs are downloads |
| Public images | Brief 60-second cache; server checks current permissions before reading its cache |

The directory is configured coverage, not proof of 5,000 simultaneous observations. Unavailable or invalid prices remain missing; they are not fabricated. Most configured securities are in mainland China, with a small Hong Kong subset. This release does not implement universal asset coverage, licensed Wind data, a proprietary terminal replica or live trade execution.

Auth, writes and dynamic reads use separate Workers rate-limit namespaces. Auth checks IP and account identifier; writes use the signed-in account; all dynamic GET/HEAD routes also have an IP read limit. Limits are approximate per Cloudflare location, not a strict global spending cap. Turnstile is verified server-side on account forms, uploads and publishing. Private drafts do not require another Captcha once signed in.

Public copies already downloaded, or held in a browser's short image cache, cannot be recalled instantly when an item becomes private. Keep original evidence outside the app. Email is a login identifier: this edition has no email verification, email password recovery, admin moderation console or automated file malware scanning. Do not present it as an enterprise identity service.

## Existing installation

This replaces the previous server/container architecture in the source tree. Previous versions remain in Git history. It does not import the old Postgres database or convert old single-password access into individual accounts. Read the migration and rollback notes in [DEPLOY.md](DEPLOY.md) before publishing over an existing installation with stored data.

Keep the production `AUTH_SECRET` stable: it peppers password hashes. Changing it without a password migration makes existing passwords unverifiable. Keep all deployment credentials in GitHub Secrets and Cloudflare encrypted secrets, never in repository files.

Cloudflare free allowances are finite. R2 requires an enabled subscription and can bill usage beyond included Standard storage/operation allowances; this architecture reduces work but does not guarantee zero cost at arbitrary traffic. See [Cloudflare R2 setup](https://developers.cloudflare.com/r2/get-started/) and [pricing](https://developers.cloudflare.com/r2/pricing/).

MIT license; see [LICENSE](LICENSE).
