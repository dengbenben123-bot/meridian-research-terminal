import {appendFile} from 'node:fs/promises';

const configured = Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim());

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `configured=${configured}\n`);
}

if (!configured) {
  console.error('::error::Deployment cannot start because the repository secret CLOUDFLARE_API_TOKEN is missing or empty. Add it in GitHub Settings → Secrets and variables → Actions, then run the workflow again.');
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, '### Cloudflare authorization required\n\nThe build and tests passed, but deployment could not start because the repository secret **CLOUDFLARE_API_TOKEN** is missing or empty. Add it in GitHub Settings → Secrets and variables → Actions, then run the workflow again. See DEPLOY.md in the repository.\n');
  }
  process.exitCode = 1;
} else {
  console.log('Cloudflare deployment authorization is present. No credential was printed.');
}
