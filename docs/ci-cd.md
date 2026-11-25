# CI/CD for GATHO

How a change gets from a commit to production: GitHub Actions checks it, Vercel deploys the web app, and the VM
is updated with `deploy/update.sh`. Written for whoever maintains the repository (Step 9, 2026-11-25).

## What CI checks (`.github/workflows/ci.yml`)

Runs on every push and pull request. A newer push to the same branch or PR cancels the older run.

| Job | What it checks |
|---|---|
| `api-schema-and-unit` | `web/src/api/openapi.json` matches the API (`export_openapi.py --check`); Python unit tests (`tests/unit`, no services) |
| `web` | generated types current (`check:api`), typecheck, lint, Vitest, `next build`, **first-load JS budget** for `/` and `/routes` (`check:bundle`, `web/bundle-budget.json`), and the Playwright project `unreachable` (answers `/v1` itself: needs no API, engines or basemap) |
| `deploy-files` | `shellcheck -x deploy/*.sh`; `docker compose config` of `deploy/docker-compose.prod.yml` with dummy secrets; `caddy validate` of `engine/caddy/Caddyfile.prod` in the pinned Caddy image |

Not in CI, run on the laptop (CLAUDE.md lists the commands): `pytest tests/api` (Postgres and Redis),
`pytest -m integration` (the engines), the other Playwright projects (the live stack), Lighthouse (needs the
226 MB basemap).

### The bundle budget

`web/bundle-budget.json` holds the measured first-load JS (gzip) and a limit 3 % above it. When a change goes over:
first load the new code with `import()` (as the QR code and Follow are); raise the limit only on purpose, in its own
commit, with the reason in `note`. Measure locally with `npm run build` then `npm run check:bundle` (or
`NEXT_DIST_DIR=.next-check node scripts/bundle-size.mjs` for another build folder).

## Protect `main`

Do this once, in GitHub: **Settings → Branches → Add branch ruleset** (or "Add classic branch protection rule")
for `main`:

1. **Require a pull request before merging.** This stops direct pushes to `main`. Approvals: 0 is fine for a solo
   developer; the point is that CI runs before the merge.
2. **Require status checks to pass**, and pick: `api-schema-and-unit`, `web`, `deploy-files`. (A check appears in
   the list only after it has run once on a branch.) Tick **Require branches to be up to date before merging**.
3. **Block force pushes** and **restrict deletions**.
4. Leave "Allow bypass" off, or limited to yourself for emergencies.

From then on: work on a branch, open a PR, merge when it is green.

## The web app: Vercel

- **Every push to `main` deploys production** at https://gatho.shahinsha.xyz. Pushes to other branches (and PRs)
  get a **preview deployment** with its own URL; previews use the Preview environment's variables.
- **A push to `main` is a deploy.** If the web change needs a new API (as Step 9 did: `/v1/session/link`), update
  the VM first (below), then merge or push to `main`.
- **`NEXT_PUBLIC_*` variables live in the Vercel project** (Settings → Environment Variables), not in the repo. They
  are inlined at build time, so **changing one needs a redeploy** (Deployments → the latest → Redeploy).

| Variable | Production value | What it does |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | `https://api.gatho.shahinsha.xyz` | every API call |
| `NEXT_PUBLIC_BASEMAP_ORIGIN` | `https://api.gatho.shahinsha.xyz` | the PMTiles archive, fonts and sprites |
| `NEXT_PUBLIC_SITE_URL` | `https://gatho.shahinsha.xyz` | absolute OpenGraph and icon links |
| `NEXT_PUBLIC_CONTACT_EMAIL` | an address you read (optional) | the contact line on About; left out when unset |

Rolling back the web app: Vercel → Deployments → an earlier production deployment → **Promote to Production**.

## The server: `deploy/update.sh`

The VM is not deployed by a push. To update it, log in and run:

```
ssh -i <key>.pem ubuntu@54.252.91.95
cd ~/athlete_router && bash deploy/update.sh
```

`update.sh` refuses a checkout with local changes. It then:

1. pulls `main` (fast-forward only);
2. rebuilds the API image, keeping the old one as `athlete-api:rollback`;
3. runs the migrations;
4. restarts the API and waits for it to be healthy;
5. recreates Caddy if `Caddyfile.prod` changed or its basemap mount is stale, and checks the mount.

If the new API is not healthy within 3 minutes, `update.sh` puts the previous image back. It does not roll back the
code checkout or the migrations (`deploy/RUNBOOK.md`, "Update"). Afterwards: `bash deploy/health.sh` and
`bash deploy/smoke.sh`.

Optional: the manual GitHub workflow below runs the same command over SSH.

## Optional: deploy the server from GitHub (`deploy-server.yml`)

**Off by default.** A manual workflow (Actions → deploy-server → Run workflow, type `update`) that connects to the
VM over SSH and runs `cd ~/athlete_router && bash deploy/update.sh`. The run fails if `update.sh` fails. It never
runs on a push, two runs never overlap, and it stops at the first step until all four secrets exist.

**Precondition: SSH must be open to GitHub's runners.** GitHub-hosted runners connect from changing IP addresses
(many ranges, changing often), so the VM's AWS security group would have to allow port 22 from anywhere
(`0.0.0.0/0`). Today it does not need to, and nothing in this repository changes it. Only you can decide to open it,
in the AWS console.

**The risk if you open it:** port 22 is then reachable from the whole internet, so it gets scanned and
brute-forced around the clock. That is acceptable only with **key-only login**: `PasswordAuthentication no` and
`PermitRootLogin no` in `/etc/ssh/sshd_config` (Ubuntu on EC2 has both by default; check with
`sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin'`), and keeping the VM patched. The key in GitHub
can do anything the `ubuntu` user can, Docker included. If it leaks, whoever holds it controls the server. Lower-risk
alternatives: keep running `update.sh` by hand (the default), or open port 22 to your own IP only and run it from
your machine.

**Setup, if you decide to:**

1. Make a key for this purpose only, on your machine: `ssh-keygen -t ed25519 -f gatho-deploy -N "" -C gatho-deploy`.
2. On the VM, add `gatho-deploy.pub` to `~/.ssh/authorized_keys` of `ubuntu` (to limit it to this command, prefix
   the line with `command="cd ~/athlete_router && bash deploy/update.sh",no-port-forwarding,no-pty `).
3. Pin the host key: `ssh-keyscan -t ed25519 54.252.91.95` from a network you trust, and compare its fingerprint
   (`ssh-keygen -lf <file>`) with the one the VM prints (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`).
4. In GitHub: Settings → Secrets and variables → Actions, add `VM_HOST` (`54.252.91.95`), `VM_USER` (`ubuntu`),
   `VM_SSH_KEY` (the whole private key file) and `VM_KNOWN_HOSTS` (the `ssh-keyscan` line). The job runs in the
   `production` environment: add required reviewers there if you want a second click before each run.
5. Open port 22 in the security group as described above.

To turn it off again: delete the secrets (the workflow then stops at its first step), remove the key from
`authorized_keys`, and close port 22 to everyone except yourself.
