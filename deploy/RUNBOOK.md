# GATHO API server: runbook

The server at **https://api.gatho.shahinsha.xyz** runs the API and serves the map tiles for the front end at
https://gatho.shahinsha.xyz (on Vercel). This runbook takes you from a stopped AWS instance to a working
server, then covers day-to-day tasks. Run every command exactly as shown. Lines starting with `#` are
explanations, not commands.

| | |
| --- | --- |
| Machine | AWS EC2 m7i-flex.large: 2 vCPU, 7.6 GiB RAM, 4 GiB swap (added by the bootstrap), Ubuntu 24.04 LTS |
| Region | ap-southeast-2 (Sydney) |
| Address | Elastic IP 54.252.91.95 (DNS: `api.gatho.shahinsha.xyz` points at it) |
| Login | user `ubuntu`, with your key file (`<key>.pem` below) |
| Code | `/home/ubuntu/athlete_router` (this repository) |
| Costs | [COSTS.md](COSTS.md) |

**Where commands run.** "On the laptop" means PowerShell on your Windows laptop. "On the server" means inside
the SSH session (the prompt looks like `ubuntu@ip-...:~$`).

---

## First deployment, in order

### 1. Check the AWS firewall (security group), once

In the AWS console: **EC2 → Instances →** your instance **→ Security** tab **→** the security group **→ Edit
inbound rules**. You need exactly these rules:

| Type | Port | Source | Why |
| --- | --- | --- | --- |
| SSH | 22 | **My IP** (better than anywhere) | your login |
| HTTP | 80 | 0.0.0.0/0 and ::/0 | Let's Encrypt checks the domain on port 80 |
| HTTPS | 443 | 0.0.0.0/0 and ::/0 | the site |

If your home IP changes, SSH stops working: edit the SSH rule again and choose "My IP".

### 2. Start the instance

AWS console → **EC2 → Instances →** tick the instance → **Instance state → Start instance**. Wait until
"Instance state" says **Running** and "Status check" says **3/3 checks passed** (one or two minutes).

### 3. Log in with SSH (on the laptop)

Windows refuses a key file that other users can read. Fix that once:

```powershell
icacls "C:\path\to\<key>.pem" /inheritance:r /grant:r "$($env:USERNAME):R"
```

Then log in:

```powershell
ssh -i "C:\path\to\<key>.pem" ubuntu@54.252.91.95
```

The first time it asks "Are you sure you want to continue connecting?": type `yes`. To log out: `exit`.

### 4. Get the code (on the server)

```bash
git clone https://github.com/exassaro/Athletic_Route_Planner.git athlete_router
cd ~/athlete_router
```

If the repository is private, git asks for a username and password. Use a GitHub fine-grained personal access
token with read access to this one repository as the password (GitHub → Settings → Developer settings).

### 5. Prepare the machine (on the server, about 5 minutes)

```bash
bash deploy/bootstrap_vm.sh
```

This installs Docker, adds 4 GB of swap, turns on the firewall (22, 80 and 443 only) and automatic security
updates, and installs git, curl, jq and uv. **Afterwards, log out and log in again** (`exit`, then the `ssh`
command from step 3). Docker only works for you after a new login. If the script says a reboot is wanted, run
`sudo reboot`, wait a minute, and log in again.

Check: `docker ps` prints an empty table, without "permission denied".

### 6. Create the secrets (on the server)

```bash
cd ~/athlete_router
bash deploy/gen_secrets.sh
cat deploy/.env.prod
```

This writes `deploy/.env.prod` with a random database password. **Copy the `POSTGRES_PASSWORD` line into your
password manager.** The database cannot be opened without it, and git does not keep this file.

### 7. Copy the map tiles from the laptop

The map archive came from a Protomaps daily build that has since been deleted upstream (it answered 404 on
2026-11-24), so the server cannot download it. Copy your laptop's file instead (226 MB).

On the server:

```bash
mkdir -p ~/athlete_router/data/basemap
```

On the laptop, from the repository folder (`D:\athlete_router`):

```powershell
scp -i "C:\path\to\<key>.pem" data\basemap\kerala-20261115.pmtiles ubuntu@54.252.91.95:/home/ubuntu/athlete_router/data/basemap/
```

`first_run.sh` checks the file against the pin's sha256, so a broken copy is caught.

The OSM extract downloads by itself from the project's GitHub release. If that ever fails, copy
`data\osm\kerala.osm.pbf` the same way into `/home/ubuntu/athlete_router/data/osm/`.

### 8. First run (on the server, about 30 to 60 minutes)

Start it inside `tmux`. If your SSH connection drops, tmux keeps the script running:

```bash
cd ~/athlete_router
tmux new -s setup
bash deploy/first_run.sh
```

- To leave tmux and let it run: press `Ctrl+B`, then `D`. To come back later: `tmux attach -t setup`.
- Every step prints how long it took. The long ones are the Valhalla tile build (downloads elevation and
  builds the graph) and the GraphHopper import.
- **If it stops with an error**, fix what it says and run `bash deploy/first_run.sh` again. Finished steps are
  skipped.

The order matters for memory. Data downloads come first, then Postgres and Redis, migrations, the OSM tables,
the Valhalla build, the GraphHopper import, Photon, the API and Caddy. The Valhalla tile build never runs
beside Photon: the compose file makes Photon wait until Valhalla is built and healthy.

At the end, `first_run.sh` runs the health check. Caddy gets the HTTPS certificate from Let's Encrypt within a
minute of starting, provided DNS points here and ports 80 and 443 are open (step 1).

### 9. Health check and smoke test (on the server, or on the laptop in Git Bash)

```bash
bash deploy/health.sh
bash deploy/smoke.sh
```

- `health.sh` checks `/v1/health`, the API's CORS for the front end, and a Range request on `kerala.pmtiles`
  (206, CORS, `no-store`, not compressed). It also checks the basemap preflight, font caching, disk, memory
  and containers.
- `smoke.sh` runs a whole journey: a session, plans A01 (Athanikkal towards Kozhikode, 25 km), saves it,
  downloads the GPX, and opens the share page on https://gatho.shahinsha.xyz. Then it deletes the saved route
  again (`KEEP=1 bash deploy/smoke.sh` keeps it).

Both print `ok` or `FAIL` per check. The share-page check needs the Vercel deployment built with
`NEXT_PUBLIC_API_BASE=https://api.gatho.shahinsha.xyz` and
`NEXT_PUBLIC_BASEMAP_ORIGIN=https://api.gatho.shahinsha.xyz` (web/README.md, "Split origin"). Changing either
needs a Vercel redeploy.

### 10. Daily backup (on the server, once)

```bash
crontab -e
```

Choose `nano` if asked. Add this line at the bottom, then save with `Ctrl+O`, `Enter`, and exit with `Ctrl+X`:

```
30 18 * * * /bin/bash /home/ubuntu/athlete_router/deploy/backup.sh >> /home/ubuntu/backups/backup.log 2>&1
```

It runs every day at 18:30 UTC (midnight in India). Backups only run while the instance is running.

---

## Stop the instance when idle

The instance costs money for every hour it runs (see [COSTS.md](COSTS.md)). When nobody needs the site, stop
it: AWS console → **Instances →** tick it → **Instance state → Stop instance**.

- **Stop, never Terminate.** Terminate deletes the machine and its disk, including the database.
- A stopped instance still pays for its disk and its Elastic IP, about $7.50 a month (COSTS.md).
- While it is stopped, the front end loads but cannot plan routes or show the map.

## Restart after a stop

1. Console → **Instance state → Start instance**. Wait for **3/3 checks passed**.
2. The Elastic IP stays the same, so DNS and the `ssh` command do not change.
3. The containers start by themselves (`restart: unless-stopped`). GraphHopper needs a minute or two to load
   its graph.
4. Check it: log in, then `cd ~/athlete_router && bash deploy/health.sh`. If something is still starting, wait
   a minute and run it again.

## Update to the latest code

On the laptop: commit and push to `main`. Then, on the server:

```bash
cd ~/athlete_router
bash deploy/update.sh
```

It pulls, rebuilds the API image, runs migrations and restarts **only the API**. If the new API is not healthy
within 3 minutes, it puts the previous image back.

- **Migrations are not undone by the rollback.** If a migration broke the old code, restore the backup taken
  before the update (run `bash deploy/backup.sh` before updating when a migration is involved).
- **Caddyfile.prod changed:**
  `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod exec caddy caddy reload --config /etc/caddy/Caddyfile`
- **The compose file changed:**
  `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d` (recreates only the
  services that changed).
- **engine/valhalla/overrides.json changed:** run the Valhalla step again with `bash deploy/first_run.sh`
  (finished steps are skipped; it applies the overrides and restarts Valhalla).
- **GraphHopper config or custom models changed:** stop Photon first, then rebuild GraphHopper:
  `rm -rf data/graphhopper/graph-cache`, `docker compose ... build graphhopper`, `docker compose ... up -d graphhopper`.
- **The basemap pin changed:** copy the new archive as in step 7, then run `bash deploy/first_run.sh`.

## Backup

```bash
bash deploy/backup.sh
```

This writes `/home/ubuntu/backups/athlete-YYYY-MM-DD.dump` and keeps the newest 7. The OSM tables are left out:
they come from the pinned extract, and the restore loads them again.

Backups live on the same disk as the database. Copy one to the laptop now and then (on the laptop):

```powershell
scp -i "C:\path\to\<key>.pem" ubuntu@54.252.91.95:/home/ubuntu/backups/athlete-2026-11-24.dump D:\gatho-backups\
```

Run `ls ~/backups` on the server to see the available dates.

## Restore

```bash
bash deploy/restore.sh /home/ubuntu/backups/athlete-2026-11-24.dump
```

It asks you to type `yes`. It saves the current database first (`before-restore-*.dump`), stops the API,
restores, loads the OSM tables (a few minutes) and starts the API. To restore a dump from the laptop, copy it to
`/home/ubuntu/backups/` with `scp` first (as above, with source and destination swapped).

## Disk full

Check what is using the disk:

```bash
df -h /
docker system df
du -sh ~/athlete_router/data/* ~/backups
```

Then free space, safest first:

1. Old Docker images and build cache: `docker image prune -f` and `docker builder prune -f`. The images in use,
   and `athlete-api:rollback`, are kept.
2. System logs: `sudo journalctl --vacuum-size=200M`, then `sudo apt-get clean`.
3. Old backups in `~/backups` (copy them to the laptop first if you want them).
4. The Photon download archive: `rm ~/athlete_router/data/photon/photon-db-india.tar.bz2` frees 610 MB.
   Photon keeps working. A later `first_run.sh` would download it again.

Still not enough: make the disk bigger. Console → **Elastic Block Store → Volumes →** the instance's volume →
**Modify** → a larger size. Then, on the server:

```bash
lsblk                                   # find the disk and partition, usually nvme0n1 and nvme0n1p1
sudo growpart /dev/nvme0n1 1
sudo resize2fs /dev/nvme0n1p1
df -h /
```

Container logs cannot fill the disk: each container keeps at most 3 files of 10 MB, and Caddy rotates its
access log.

## Where the logs are

| What | Command or place |
| --- | --- |
| API | `docker logs --tail 100 -f athlete-prod-api` (`Ctrl+C` stops following) |
| Caddy (certificates, errors) | `docker logs --tail 100 athlete-prod-caddy` |
| Access log (each request: IP, path, status, time) | `sudo tail -f ~/athlete_router/data/logs/caddy/access.log` (JSON lines; 50 MiB a file, 10 files, 30 days) |
| Valhalla, GraphHopper, Photon, Postgres, Redis | `docker logs --tail 100 athlete-prod-<name>` |
| Container status and health | `docker ps` |
| Backups | `~/backups/backup.log` |
| Security updates | `/var/log/unattended-upgrades/` |
| Docker itself | `sudo journalctl -u docker --since today` |

The access log holds visitors' IP addresses. It is kept for 30 days at most and is never copied anywhere.

## Memory

The VM has 7.6 GiB of RAM and 4 GiB of swap. Each container has a hard limit (`mem_limit`). The "used" column
was measured on the development laptop (docs/reports/phase4), not on this server.

| Container | Limit | Measured use | Note |
| --- | --- | --- | --- |
| graphhopper | 4,096 MiB | 2,113 MiB | Java heap 3 GiB, as in development |
| photon | 2,560 MiB | 523 MiB | heap 1.5 GiB, about 1.9 GiB resident at most; 3 GiB in dev, lowered here |
| valhalla | 2,048 MiB | 541 MiB serving | no limit in dev; the tile build's peak is **not measured** |
| api | 1,024 MiB | 125 MiB | |
| postgres | 512 MiB | 133 MiB | |
| redis | 320 MiB | 5 MiB | 256 MB cache cap, least recently used dropped |
| caddy | 256 MiB | not measured | |
| **Sum** | **10,816 MiB (10.6 GiB)** | **about 3.5 GiB** | |

The sum of the limits (10.6 GiB) is more than the RAM (7.6 GiB) but less than RAM plus swap (11.6 GiB).
Ubuntu and Docker need about 0.5 GiB of their own. The limits are ceilings that the services never reach
together. The measured working set (about 3.5 GiB) fits in RAM with about 3.5 GiB to spare. The big one-off
peaks (the Valhalla tile build, the GraphHopper import) run one at a time in `first_run.sh`, with Photon
stopped.

Watch it with `free -h` and `docker stats --no-stream`. If swap use keeps growing during normal use, something
is leaking: check `docker stats` and restart that container.

## Change the database password

The password in `.env.prod` is only read when the database is first created. To change it:

```bash
cd ~/athlete_router
NEW=$(openssl rand -hex 32)
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod exec postgres psql -U athlete -d athlete -c "ALTER USER athlete PASSWORD '$NEW'"
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW/" deploy/.env.prod
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --no-deps --force-recreate api
bash deploy/health.sh
```

Then save the new password in your password manager.

## Useful one-liners (on the server, in `~/athlete_router`)

```bash
source deploy/lib.sh                    # defines `dc` = docker compose with the production file and settings
dc ps                                   # every service and its health
dc restart api                          # restart one service
dc exec postgres psql -U athlete -d athlete   # a SQL prompt (\q to leave)
dc stop -t 90 postgres                  # stop Postgres cleanly (give it 90 s)
```
