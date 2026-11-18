# Testing on a phone over the LAN (HTTPS)

A phone browser only shares its location with an HTTPS page, so the planner is served through Caddy with its own local certificate authority (blueprint Phase 5 amendment 9). The web app, the API (`/v1`) and the tiles share one origin, so no CORS is involved.

Checked on this laptop on 2026-11-18 (LAN address 10.141.255.68):
- the three Playwright journeys pass through `https://10.141.255.68`;
- the certificate chain verifies against Caddy's root for both `10.141.255.68` and `localhost`.

**Not yet checked on a real phone.** That is for you, with the steps below.

## 1. Start everything

From the repository root, in PowerShell:

```powershell
docker compose up -d                                   # engines, Postgres, Redis
docker compose --profile geocode up -d photon          # place search
docker compose --profile api up -d api                 # the API
cd web
$env:NEXT_PUBLIC_API_BASE = "same-origin"              # the browser calls /v1 on the page's own origin
npm run build
npx next start --port 3000
```

In a second window, with your laptop's LAN address (`ipconfig`, "IPv4 Address" of the Wi-Fi adapter):

```powershell
$env:LAN_HOST = "10.141.255.68"
docker compose --profile api --profile web up -d proxy
```

Caddy creates its root certificate in `data/caddy/caddy/pki/authorities/local/root.crt` on first start.

## 2. Let the phone in through the Windows firewall

In an administrator PowerShell, once:

```powershell
New-NetFirewallRule -DisplayName "Athlete Router HTTPS (LAN)" -Direction Inbound -Protocol TCP -LocalPort 443 -Profile Private -Action Allow
```

The Wi-Fi network must be set to **Private** in Windows. The phone must be on the same Wi-Fi.

## 3. Trust Caddy's root certificate on the phone

Copy `data/caddy/caddy/pki/authorities/local/root.crt` to the phone (for example by email to yourself, or USB).

- **Android:** Settings → Security and privacy → More security settings → Encryption and credentials → Install a certificate → CA certificate → choose `root.crt`. Chrome uses the system store.
- **iPhone:** open the file, then Settings → Profile Downloaded → Install. After that: Settings → General → About → Certificate Trust Settings → turn on full trust for "Caddy Local Authority".

Remove the certificate when testing is over. Anyone holding `root.key` could issue certificates the phone trusts. The key stays in `data/caddy/`, which is gitignored.

## 4. Open the planner

On the phone: `https://10.141.255.68/` (your address). "Use my location" should ask for permission.

## If something fails

| Symptom | Cause |
| --- | --- |
| The page does not load at all | Firewall rule missing, network not Private, or the phone is on another Wi-Fi (guest networks often isolate devices) |
| "Your connection is not private" | The root certificate is not trusted yet (step 3), or `LAN_HOST` does not match the address you typed |
| "Location is not available (a phone needs HTTPS for this)" | The page was opened over `http://` |
| Map blank, planner works | `engine/scripts/fetch_basemap.py` not run, so there is no `web/public/basemap/` |

A quick shortcut for Android Chrome without the certificate: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://10.141.255.68:3000`. That needs the web app built with the API address instead of `same-origin`, and CORS allowing that origin (`ATHLETE_CORS_ORIGINS`). It is a developer flag, so it's not recommended for the hallway test.
