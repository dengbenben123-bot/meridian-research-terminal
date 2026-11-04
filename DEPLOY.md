# Publish v6 with one Cloudflare credential

The GitHub workflow needs only **one repository secret: `CLOUDFLARE_API_TOKEN`**. Account ID, database, file namespace, origin, app secret and Turnstile keys are discovered or prepared automatically.

This updates the existing Worker at:

https://meridian-research-terminal.cooked-jersey.workers.dev/

## One-time authorization

1. Open [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens), choose **Create Token**, and use the **Edit Cloudflare Workers** template. Restrict it to the account that owns `cooked-jersey.workers.dev`.
2. Ensure these **Account** permissions are included:

   | Permission | Access |
   | --- | --- |
   | Workers Scripts | Edit |
   | Account Settings | Read |
   | D1 | Edit |
   | Workers KV Storage | Edit |
   | Turnstile | Edit |

   If your dashboard uses granular roles, give Workers Editor for the existing Worker and resource creation access for D1, KV and Turnstile. Under the granular model, Editor cannot create a missing resource; the initial setup needs the corresponding product Admin permission. An existing `FILES` R2 binding also requires R2 access. Limit the token to the intended account.
3. Copy the token directly into [GitHub repository Secrets](https://github.com/dengbenben123-bot/meridian-research-terminal/settings/secrets/actions): select **New repository secret**, name it **`CLOUDFLARE_API_TOKEN`**, paste the token into **Secret**, and save.

The token is the only value you need to copy. Keep it out of source files and chat. Cloudflare dashboard login alone does not authorize a GitHub runner. This repository cannot add the credential on your behalf through its connected GitHub integration.

New installations use Workers KV and do not need R2 enabled. Cloudflare free plan limits apply. Existing R2 installations retain their existing R2 binding and subscription requirements.

## Deploy

Open [Check and deploy Meridian](https://github.com/dengbenben123-bot/meridian-research-terminal/actions/workflows/cloudflare.yml), select **Run workflow → main → Run workflow**.

There is no need to upload source again, find an entry module, run a local website or use Docker. Future pushes to `main` use the same authorization. Use this GitHub Actions workflow as the publishing path; do not run a second Workers Builds pipeline against the same Worker.

## What happens automatically

- Check types, run tests, build Vue and pre-render public pages.
- Discover the authorized account that owns `cooked-jersey.workers.dev` and confirm that `meridian-research-terminal` already exists. No new Worker, hostname or claim link is created.
- Retain the existing compatibility date/flags, unrelated text variables and encrypted secrets, and legacy KV bindings.
- Reuse the existing `DB` and file storage bindings. For a new installation, find or create `meridian-platform` and a KV namespace named `meridian-v6-files`.
- Retain existing R2-backed files. If the R2 bucket allows direct public access, stop for review to protect private files.
- Stop when existing file records have no storage binding, rather than switching their backend silently.
- Inspect an existing D1 database before migration. Empty databases or the recognized v6 schema are accepted; older or unrelated data stops deployment for a reviewed migration. No existing table is dropped, reset or replaced.
- Reuse the configured production Turnstile widget, or prepare a managed widget for this exact hostname. Existing widget secrets are not rotated. Keys go directly to Cloudflare encrypted Worker secrets.
- Generate a random `AUTH_SECRET` only when none exists. Existing password secrets are preserved on future deployments. A legacy plaintext app secret is moved to an encrypted binding with the same value.
- Write only nonsecret deployment metadata to the ignored `wrangler.deploy.json`, bundle with that configuration, apply migrations, synchronize app secrets, deploy and verify the release.

Generated credentials stay in process memory until uploaded to Cloudflare. They are masked in GitHub Actions and are not stored in repository files or artifacts. The deployment API token is never added as an application variable. Resource setup is resumable: existing matching resources are reused after a failed attempt. Unsupported legacy bindings and incompatible schemas stop for review instead of silently deleting data.

## Verify

In the `deploy` job, **Run npm run deploy** must have run successfully. A green workflow with that step marked **Skipped** means publishing did not happen.

The final command checks the release at the existing URL. Open:

https://meridian-research-terminal.cooked-jersey.workers.dev/healthz

The response must include `"status":"ok"` and `"version":"6.0.0"`. The final log also reports that the public pages, anonymous session and private API gate were verified. Test normal registration/Turnstile, a private note and a small file in your browser after deployment; automated verification does not create a production account.

## If a run stops

| Message | Action |
| --- | --- |
| Publishing was skipped | Add the single repository secret `CLOUDFLARE_API_TOKEN`, then run the workflow again. |
| 401 / 403 / cannot find the account | Check the token's expiry, account scope and the five permissions above. |
| KV access failed | Check that the token has Workers KV Storage Edit permission and the account has available KV capacity. |
| Existing R2 access failed | Check R2 Storage permissions and that the existing R2 subscription remains enabled. |
| Existing schema or binding needs migration | Preserve the named resource. Review a code/data migration; do not delete it to make the deployment pass. |
| Worker settings changed during preparation | Someone else changed relevant settings. Review the change, then retry. |
| Live release not verified | Read the deployment log; a successful source build is not proof that v6 is live. |

The previous v4.4.1 data is not automatically converted into v6 accounts. Existing Cloudflare resources are retained, but a recognized schema or a deliberate data migration is required to reuse a populated database. A code rollback is available in the existing Worker's Deployments history; it does not roll back D1 migrations or restore deleted R2 files.

## Advanced manual path

The old explicit configuration remains available as `npm run deploy:manual`. It requires the five metadata values in `.env.example` and the private `CLOUDFLARE_API_TOKEN`, `AUTH_SECRET` and `TURNSTILE_SECRET_KEY` environment variables. It is not used by the default GitHub workflow. Preserve the same production `AUTH_SECRET` if using that path.

Official references: [GitHub Actions authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [Workers permissions](https://developers.cloudflare.com/workers/authorization/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [D1 API](https://developers.cloudflare.com/api/resources/d1/), [Turnstile widget API](https://developers.cloudflare.com/turnstile/get-started/widget-management/api/).
