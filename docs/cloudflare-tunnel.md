# Cloudflare Tunnel for Private AI Note Keeper

Optional operator choice: the core project **`docker-compose.yml`** does **not** bundle Cloudflare. If you adopt this ingress, merge **`docker-compose.cloudflare.yml`** (see commands below).

This gives you **`https://…`** reaching the app inside Docker **without opening inbound ports** on your router. Browsers treat that as a **secure context**, so the **microphone**, **WebSockets** (job watch), and the rest of the UI work like a normal HTTPS site.

Official reference: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

There are **two flavours**:

| | **Quick Tunnel** (`*.trycloudflare.com`) | **Named tunnel + your hostname** |
|---|-------|--------------|
| **Domain** | **Not required.** No registrar, no DNS zone. | You need a **domain on Cloudflare** (or delegated to them). |
| **URL stability** | New random hostname whenever the connector runs. | Stable **`https://notes.yourdomain.com`**. |
| **Account / token** | **Not required** for basic use (connector dials Cloudflare). | Zero Trust tunnel + **`CLOUDFLARE_TUNNEL_TOKEN`**. |
| **Compose** | Merge **`docker-compose.cloudflare.yml`**; **`--profile tunnel-quick`** | Same overlay; **`--profile tunnel`** (+ token in `.env`) |

Choose **quick** to try HTTPS + mic remotely in minutes. Choose **named** when you want a fixed URL you can bookmark and share.

---

## Compose usage (overlay)

Always pass **both** the core stack file and this overlay, from the repo root (`docker-compose.cloudflare.yml` is ignored unless you `-f` it). **Shortcuts:**

```bash
make tunnel-quick
make tunnel-up
```

Underlying commands:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml --profile tunnel-quick up -d
# named tunnel (--profile tunnel) needs CLOUDFLARE_TUNNEL_TOKEN in .env
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml --profile tunnel up -d
```

For a tidy shutdown when anything from the overlay was running, **`make down`** merges both Compose files (`Makefile`).

---

## Option A: No domain — Quick Tunnel (Try Cloudflare)

Cloudflare exposes your service on a random subdomain like **`https://random-name.trycloudflare.com`**.

**Limits (check current [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/)):**

- Intended for demos and short-lived access, not necessarily production SLAs.
- URL **changes each time** you restart the connector (unless you migrate to a named tunnel).

### Start from this repo

1. Bring up main stack plus Cloudflare overlay with the **`tunnel-quick`** profile (no **`CLOUDFLARE_TUNNEL_TOKEN`** needed):

```bash
make tunnel-quick
# equivalent:
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml --profile tunnel-quick up -d
```

2. Inspect **`cloudflared-quick`** logs for the **`https://….trycloudflare.com`** hostname:

   ```bash
   make logs-tunnel-quick
   # or: docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml logs cloudflared-quick
   ```

3. Open that URL — it stays **`https`**, which satisfies mic **secure-context** rules.

Do **not** run **`tunnel-quick`** and **`tunnel`** profiles at once on overlapping ports (pick one connector pattern).

---

## Option B: Your own hostname (named tunnel + domain)

Requires a **DNS zone managed in Cloudflare** (buy a cheap domain anywhere and point nameservers at Cloudflare, or transfer the zone).

Official Docker guide: [Cloudflare Tunnel · Docker](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deployment-guides/docker/).

### One: create a tunnel (token)

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Name it (for example `note-keeper`).
3. Under **Install connector**, choose **Docker** and copy the **token**.

### Two: point a hostname at the app

In the tunnel configuration, **Public hostname**:

| Field | Typical value |
|--------|----------------|
| Subdomain | `notes` |
| Domain | `example.com` |
| Type | **HTTP** |
| URL | **`http://app:8000`** |

Use **`http://app:8000`** when **`cloudflared`** runs **in this Compose project** with the **`app`** service (**8000** = in-container API port).

**Host install:** set service URL to **`http://127.0.0.1:8743`** (or **`APP_PORT`**).

### Three: env and Compose

```env
CLOUDFLARE_TUNNEL_TOKEN=paste_token_here
```

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml --profile tunnel up -d
# or: make tunnel-up
```

### Four: open the app

Example: **`https://notes.example.com`** — usually same-origin with the bundled UI → no **`CORS_LAN_ORIGINS`** needed.

---

## Other options if Quick Tunnel isn’t enough and you refuse to buy a domain

- **`ngrok`**, **`localtunnel`**, **Tailscale Funnel**, etc.: they hand you **`https`** on **their** subdomains similar in spirit to Try Cloudflare. Wire them at **`APP_PORT`** on the host or **`http://app:8000`** from whichever network namespace runs the tunnel client.
- Buying a minimal domain (**~\$5–\$15/year**) is often the smoothest path to a stable URL + named Cloudflare Tunnel + optional Access policies.

---

## Security notes

- **Quick Tunnel:** Anyone with the **`trycloudflare.com`** link can reach your UI while the tunnel is running. Treat the URL like a capability secret.
- **Named tunnel:** **`CLOUDFLARE_TUNNEL_TOKEN`** is a secret; rotate from the dashboard if it leaks.
- Add **Cloudflare Access** or another identity layer before exposing sensitive data broadly.

---

## Troubleshooting

- **502** — Wrong origin URL (**`http://app:8000`** in Compose sidecar vs **`http://127.0.0.1:8743`** on host).
- **Connector exits (named)** — Bad or empty token (`docker compose logs cloudflared`).
- **Mic still blocked** — Address bar must be **`https://`**, not plain **`http://`**.
