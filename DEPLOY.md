# Publish Meridian through GitHub and Cloudflare

This guide updates the **existing** `meridian-research-terminal` Worker in the account with the `cooked-jersey.workers.dev` subdomain. It does not create another Worker, another hostname or a preview claim link. You do not need Docker, a local application server or the Cloudflare code editor.

Repository: https://github.com/dengbenben123-bot/meridian-research-terminal

Site target: https://meridian-research-terminal.cooked-jersey.workers.dev/

## 1. Prepare the Cloudflare resources once

Sign in to the account that owns the existing Worker. Find its Account ID in the dashboard and retain it for step 3.

1. Under **Storage & databases → D1 SQL database**, create an empty database named `meridian-platform`. Copy its Database ID. The workflow applies `migrations/0001_platform.sql`; do not paste the schema repeatedly into a populated database.
2. Under **Storage & databases → R2**, enable R2 if necessary and create a Standard storage bucket named `meridian-files`. Keep public bucket access and `r2.dev` disabled: file access goes through the Worker, which checks permissions. R2 has included usage, but enabling it requires an R2 subscription and usage beyond the allowance can be billed.
3. Open **Turnstile**, add a managed widget, and allow the hostname `meridian-research-terminal.cooked-jersey.workers.dev` (without `https://` or a path). Copy its site key and secret key. Use real production keys, not the `1x000…` development test keys.

If this Worker already has a `DB` or `FILES` binding, use its existing resource only after confirming it contains this platform's schema/data. The deployment guard rejects attempts to silently change an existing database or bucket. An unrelated existing binding or an older/incompatible schema needs an explicit migration; creating an empty replacement and forcing deployment is not a data migration.

The account and resource names are not credentials. The token, application secret and Turnstile secret are credentials.

## 2. Create a deployment API token

Use Cloudflare's **Account API tokens → Create Token** (or the API Tokens page in your profile), starting with the **Edit Cloudflare Workers** template. Restrict it to the account that owns the existing Worker.

The pipeline needs these account permissions, using the equivalent Editor/Write labels if the dashboard displays granular roles:

- Workers Scripts Edit / Workers Editor, for the existing Worker's settings, encrypted secrets, assets and deployment.
- Account Settings Read, for account/subdomain checks.
- D1 Edit / D1 Write, for database migrations.
- Workers R2 Storage Edit, for bucket binding access/validation.

Limit resource scope where the token interface supports it. This workers.dev deployment does not add DNS records, zones, custom domains or routes. A global API key is unnecessary. This guide uses GitHub Actions, so Workers Builds configuration permissions are unnecessary too.

Put the token directly into the GitHub secret below. Do not paste it into chat, source files, commit messages or a public issue. Revoke and replace a token if it has already been exposed. Authorizing a Cloudflare dashboard browser session does not authenticate a GitHub Actions runner: the runner uses this token.

## 3. Configure GitHub settings

In the repository, open **Settings → Secrets and variables → Actions**.

On the **Variables** tab, add these Repository variables:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The existing Cloudflare account's 32-character ID |
| `CLOUDFLARE_D1_DATABASE_ID` | The real UUID of the D1 database from step 1 |
| `CLOUDFLARE_R2_BUCKET` | `meridian-files`, or the existing approved bucket name |
| `PUBLIC_ORIGIN` | `https://meridian-research-terminal.cooked-jersey.workers.dev` — no trailing slash |
| `TURNSTILE_SITE_KEY` | The production widget's public site key |

On the **Secrets** tab, select **New repository secret** for:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The account-scoped deployment token from step 2 |
| `AUTH_SECRET` | A stable, randomly generated secret with at least 32 characters |
| `TURNSTILE_SECRET_KEY` | The production widget's private secret key |

To generate a new application secret privately on your own computer, you can use a password manager or:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save that value directly as `AUTH_SECRET` and keep a secure recovery copy. **Reuse it on every redeploy.** It is used in password hashing, so replacing it without a migration breaks existing passwords. Use a different secret for another deployment/environment. If the app is already using a production `AUTH_SECRET`, preserve that value.

These are **repository** settings, not environment-specific GitHub settings: the supplied workflow does not select a GitHub Environment. Cloudflare's existing runtime variables alone are not sufficient; the build runner also needs the repository settings. It uploads only the two named app secrets to Cloudflare via standard input. The Cloudflare API token is never uploaded as an app variable.

## 4. Run the workflow

1. Open the repository's **Actions** tab and enable workflows if GitHub asks.
2. Select **Check and deploy Meridian**.
3. Select **Run workflow**, choose `main`, then select **Run workflow** again. Subsequent pushes to `main` trigger it automatically.
4. Open the resulting run and watch the `check` and `deploy` jobs.

Do not also configure an independent Workers Builds pipeline to publish the same branch: choose the GitHub Actions workflow as the deployment path. If the Worker already has a Git integration that automatically deploys, disable its automatic builds before enabling this pipeline, so two systems do not race to publish different configurations.

The pipeline:

1. Installs the committed npm lockfile and checks web/API types.
2. Runs isolated D1/R2 account, permission, file, search and quote tests, plus Vue and deployment configuration tests.
3. Builds and pre-renders public pages, then bundles the Worker without publishing.
4. Checks that all required configuration names are present. Missing values produce a visible setup warning and **skip publishing**; a green build alone is not a successful deployment.
5. Confirms the existing `cooked-jersey` account/subdomain and Worker, preserving its compatibility date and flags. It retains unrelated text variables and encrypted secrets using `keep_vars`; it deliberately sets `APP_ENV`, `PUBLIC_ORIGIN` and `TURNSTILE_SITE_KEY`, and synchronizes the two named app secrets.
6. Rejects mismatched `DB`/`FILES` bindings or other unhandled existing resource bindings. It does not silently remove them. Resolve the named migration issue in code before retrying.
7. Bundles with the actual deployment configuration, applies pending D1 migrations, uploads the app and verifies the live release.

You do **not** need to find an “entry module” in the Cloudflare dashboard. This is a multi-file source project with a build step and static assets. Pasting `src/api/index.ts`, only an `.mjs` fragment, or the Vue source into Quick Edit will not deploy the product. Commit the complete source, then use the workflow.

## 5. Verify the result

The workflow's final command runs `scripts/verify-live.mjs`. It verifies:

- `/healthz` returns HTTP 200, `status: "ok"` and version `6.0.0`.
- `/` and `/guide` serve the expected public pages.
- An anonymous request to `/api/watchlist` returns 401 with `no-store`.
- `/api/session` returns `user: null` for an anonymous client with `no-store`.

Only a successful final verification confirms that the expected release was served from the production URL. The script does not register a test account in production or bypass Turnstile. After deployment, perform one normal browser check: create an account, save a private note, sign out and confirm its link is inaccessible; sign back in and publish a selected note. Also check a small private file and one owned watchlist quote request. A provider outage is displayed as unavailable data, not a fabricated price.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Setup warning / deploy commands skipped | The run summary lists missing **names**, not values. Add them in GitHub repository Variables/Secrets, then rerun the workflow. |
| “You are not authenticated”, 401 or 403 | Check `CLOUDFLARE_API_TOKEN`, account scope, expiry and product permissions. Dashboard login cookies are not available to Actions. |
| Account/subdomain mismatch | Use the account that owns `cooked-jersey.workers.dev`. Do not change the Worker name to create a replacement. |
| Binding migration guard stops deployment | Review the existing binding identified in the log; preserve its data and add a reviewed migration/configuration update. |
| D1 migration fails | Confirm Database ID and schema. Check the named migration error; do not drop a populated database or rerun raw CREATE TABLE SQL. |
| `/healthz` is 503 / “Accounts unavailable” | Check D1 migrations, R2 binding, app secret, production Turnstile keys and exact `PUBLIC_ORIGIN`. |
| Captcha does not load or verify | Check the widget hostname, real site/secret pair, permitted challenge scripts and network access. Tokens are single use and expire. |
| 429 | Wait and retry. The app has explicit rate limits; repeated reloads can share an IP allowance. |
| Public source unavailable / partial quote response | Retry later. Configured directory coverage does not guarantee that a public source supplies every price. |
| The old site is still visible | Check that the deploy command actually ran and the live verification passed. A skipped deploy or successful source build has not published a release. |

## Migration, compatibility and rollback

The earlier server/container edition stays in Git history. No old Postgres data is automatically copied into D1, and previous single-password access is not converted into named accounts. Export and retain old records before migrating them. The initial D1 schema is for a new empty platform database; schema collisions require a deliberate migration.

Deployment checks read the current compatibility date and flags and use them for the upload. They do not change the old runtime policy behind your back. Unsupported compatibility settings stop deployment for review. Existing unrelated variables/secrets remain in Cloudflare. Check the generated binding/configuration changes before deliberately introducing another resource.

For a code regression after a completed deployment, use the existing Worker's **Deployments** history in Cloudflare to roll back to the prior version. A Worker rollback does not reverse D1 migrations, delete user records or restore deleted R2 files. Retain database/file backups before data-changing migrations. A new GitHub commit should be checked and deployed normally after the issue is fixed.

## Optional command-line deployment

GitHub Actions is the recommended path. If you use an authenticated shell instead, install dependencies, set the same metadata and secrets as environment variables privately, then run:

```sh
npm ci
npm run check
npm test
npm run deploy
```

`npm run deploy` uses the same target checks, actual-config dry run, secret synchronization, migrations, deployment and live verification. It does not start a local website. Do not use `wrangler deploy --temporary`, create another Worker to avoid authentication, or commit a generated `wrangler.deploy.json` / local secret file.

Official references: [GitHub Actions authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/), [D1 setup](https://developers.cloudflare.com/d1/get-started/), [R2 setup and subscription](https://developers.cloudflare.com/r2/get-started/), [Turnstile server-side verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
