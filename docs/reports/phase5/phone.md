# Testing on a phone over the LAN (HTTPS)

A phone browser only shares its location with an HTTPS page, so the planner is served through Caddy with its own local certificate authority (blueprint Phase 5 amendment 9). The web app, the API (`/v1`) and the tiles share one origin, so no CORS is involved.

**The address to open always starts with `https` and has no port.** On `:3000` the page loads, but there is no API there, and over http there is no location.

Checked on this laptop on 2026-11-18 (LAN address then 10.141.255.68):
- the three Playwright journeys pass through `https://10.141.255.68`;
- the certificate chain verifies against Caddy's root for both `10.141.255.68` and `localhost`.

**Checked on a real phone on 2026-11-18:** a Redmi 12 5G (Android), by the developer, over Wi-Fi on the same network as the laptop, with Caddy's root installed. It ran well. Two things that mattered: the Wi-Fi was set to Public, which blocks the phone until it is set to Private (step 2); and the firewall rule was removed afterwards.

## 1. Start everything

From the repository root, in PowerShell:

```powershell
$env:LAN_HOST = "<LAN IP>"                             # ipconfig: "IPv4 Address" of the Wi-Fi adapter
docker compose --profile geocode --profile api --profile web up -d   # every service, and the HTTPS proxy
cd web
$env:NEXT_PUBLIC_API_BASE = "same-origin"              # the browser calls /v1 on the page's own origin
npm run build
npx next start --port 3000                             # leave it running
```

When only the Wi-Fi address changes, there is nothing to build. Point the proxy at the new one, from the repository root:

```powershell
$env:LAN_HOST = "<LAN IP>"
docker compose --profile api --profile web up -d --no-deps proxy
```

Caddy creates its root certificate in `data/caddy/caddy/pki/authorities/local/root.crt` on first start.

## 2. Let the phone in through the Windows firewall

Only if the phone cannot load the page. Docker Desktop and Node may already have allow rules for the network's profile (on this laptop, since 2026-11-22, they do for Public too, so this step is not needed). Otherwise, in an administrator PowerShell, once:

```powershell
New-NetFirewallRule -DisplayName "Athlete Router HTTPS (LAN)" -Direction Inbound -Protocol TCP -LocalPort 443 -Profile Private -Action Allow
```

For that rule the Wi-Fi network must be set to **Private** in Windows (check with `(Get-NetConnectionProfile -InterfaceAlias WiFi).NetworkCategory`; as administrator, `Set-NetConnectionProfile -InterfaceAlias WiFi -NetworkCategory Private`, only on a network you trust). Remove the rule when you are done: `Remove-NetFirewallRule -DisplayName "Athlete Router HTTPS (LAN)"`. The phone must be on the same Wi-Fi.

## 3. Trust Caddy's root certificate on the phone

Copy `data/caddy/caddy/pki/authorities/local/root.crt` to the phone (for example by email to yourself, or USB).

- **Android:** Settings → Security and privacy → More security settings → Encryption and credentials → Install a certificate → CA certificate → choose `root.crt`. Chrome uses the system store.
- **iPhone:** open the file, then Settings → Profile Downloaded → Install. After that: Settings → General → About → Certificate Trust Settings → turn on full trust for "Caddy Local Authority".

Remove the certificate when testing is over. Anyone holding `root.key` could issue certificates the phone trusts. The key stays in `data/caddy/`, which is gitignored.

## 4. Open the planner

On the PC: `https://localhost`. On the phone: `https://<LAN IP>`. "Use my location" should ask for permission.

## If something fails

| Symptom | Cause |
| --- | --- |
| The page does not load at all | The phone is on another Wi-Fi, the Wi-Fi isolates devices (guest networks often do), or the firewall blocks it (step 2) |
| "GATHO's API isn't at this address." | The page was opened on `:3000` or over http. Open the https address, without a port |
| "GATHO's API didn't answer properly (502)." | The proxy is up and the API is not: `docker logs athlete-api` |
| "Your connection is not private" | The root certificate is not trusted yet (step 3), or `LAN_HOST` does not match the address you typed |
| "Location needs a secure page: open the planner over https://." | The page was opened over `http://` (anything but `localhost`) |
| "Your location could not be found…" | The device gave no position in 15 s (Windows Location services off, no GPS fix). A laptop's position comes from Wi-Fi or IP and can be kilometres off |
| Map blank, planner works | `engine/scripts/fetch_basemap.py` not run, so there is no `web/public/basemap/` |
