# MamaCheck Backend — CI/CD Pipeline

## Pipeline Stages

| # | Stage | Description |
|---|-------|-------------|
| 1 | **Lint & Test** | ESLint + Jest across Node 20.x & 22.x with live MongoDB service, 70% coverage threshold enforced |
| 2 | **PRD Compliance** | Verifies core modules, required endpoints, security controls, and 5-language support are all present in source |
| 3 | **Build** | Production artifact creation (src + package files, no node_modules) |
| 4 | **Deploy to Staging** | SCP artifact to server → SSH deploy with PM2, health-check verification |
| 5 | **Integration Tests** | End-to-end tests run against live staging environment |
| 6 | **Deploy to Production** | Blue-green deploy with timestamped backups and automatic rollback on health-check failure |
| 7 | **Production Monitoring** | Health checks on `/health` and `/api/v1/health` endpoints after deploy |
| 8 | **Deployment Report** | Full pipeline summary uploaded as a GitHub Actions artifact |

---

## Trigger Behaviour

| Event | What runs |
|-------|-----------|
| Push to any branch | Lint, test, PRD compliance, build |
| Push to `staging` | All of the above + deploy to staging + integration tests |
| Push to `main` | All of the above + deploy to production (only if build succeeded and integration tests passed or were skipped) |
| Pull request | Lint, test, PRD compliance, build — no deployments |
| Manual (`workflow_dispatch`) | Full pipeline |

---

## Required GitHub Secrets

Add these in **Repo → Settings → Secrets and variables → Actions → New repository secret**.

| Secret Name | What it is |
|-------------|-----------|
| `STAGING_SERVER_HOST` | IP address or domain of staging server |
| `STAGING_SERVER_USER` | SSH username on staging server (e.g. `ubuntu`, `deploy`) |
| `STAGING_SERVER_SSH_KEY` | Full private SSH key for staging server (including header/footer lines) |
| `PRODUCTION_SERVER_HOST` | IP address or domain of production server |
| `PRODUCTION_SERVER_USER` | SSH username on production server |
| `PRODUCTION_SERVER_SSH_KEY` | Full private SSH key for production server |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL for deploy notifications |

---

## Deployment Behaviour

- **Staging branch** → auto-deploys to staging, then runs integration tests
- **Main branch** → auto-deploys to production after build succeeds (integration tests on staging are optional — if skipped, production deploy still proceeds)
- **Automatic rollback** → if production health checks fail after deploy, the last timestamped backup is restored automatically
- **Backup strategy** → keeps the 5 most recent production backups on the server; older ones are pruned automatically

---

## Key Fixes Applied (from VS Code diagnostics)

| Error | Root Cause | Fix Applied |
|-------|-----------|-------------|
| `Unrecognized named-value: 'secrets'` in `if:` | `secrets` context is not permitted in `if:` expressions | Removed secrets checks from `if:` — Slack steps use `if: always()` with `continue-on-error: true` instead |
| `Invalid action input 'webhook-url'` | `slackapi/slack-github-action` renamed the input to `webhook` in v2 | Upgraded action to `v2.0.0` and changed input to `webhook` + `webhook-type: incoming-webhook` |
| `Value 'staging'/'production' is not valid` | VS Code extension warns when GitHub Environments don't exist yet | Create the environments in **Repo → Settings → Environments** — the YAML syntax is correct |
| `Context access might be invalid: STAGING/PRODUCTION_SERVER_*` | Secrets only resolve at runtime; VS Code flags them as warnings when environments aren't configured | Add the secrets under their respective environment in GitHub settings — warnings will clear |
| `DEPLOY_TAG` not available in ssh-action script | Env vars written to `$GITHUB_ENV` are not passed into `appleboy/ssh-action` scripts | Added `envs: DEPLOY_TAG` to the ssh-action step so the tag is explicitly forwarded |

---

## Creating GitHub Environments (fixes the 'not valid' warnings)

1. Go to **Repo → Settings → Environments**
2. Click **New environment** → name it `staging` → save
3. Click **New environment** → name it `production` → save
4. Optionally add required reviewers and deployment branch rules to `production`

Once both environments exist, the VS Code warnings for `name: staging` and `name: production` will clear.
