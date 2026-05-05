# Private AI Note Keeper

Local voice notes with transcription, categorization, key notes, storage, and memory search. The UI is a Vite React app with shadcn-style components, lucide icons, and lightweight animations.

## Screenshots

Dark, mobile-first **Capture** tab: model status on top, large mic control, optional auto-stop after silence, and live browser speech preview while recording.

<table>
  <tr>
    <td align="center" width="50%">
      <b>Ready to record</b><br/>
      <img src="docs/screenshots/capture-idle.png" alt="Capture tab idle — mic ready, models shown" width="320" />
    </td>
    <td align="center" width="50%">
      <b>Recording + live preview</b><br/>
      <img src="docs/screenshots/capture-recording.png" alt="Capture tab while listening — visualizer and preview" width="320" />
    </td>
  </tr>
</table>

<p align="center">
  <sub>Uses <code>gemma2:2b</code> and <code>nomic-embed-text</code> (shown in-app). Three-tab shell: Notes, Capture, Ask.</sub>
</p>

## Quick Start

Requirements:

- Docker Desktop
- Docker Compose
- Enough disk space for Docker images and local AI models

```bash
docker compose up --build
```

Open:

```text
http://127.0.0.1:8743
```

First boot builds `whisper.cpp`, then downloads the Whisper, chat, and embedding models into Docker volumes. That can take a while.

Copy `.env.example` to `.env` only when you want to change ports, models, or future external-access settings.

## Daily Use

Start the app:

```bash
docker compose up -d
```

Open the UI:

```text
http://127.0.0.1:8743
```

Stop the app:

```bash
docker compose down
```

View logs:

```bash
docker compose logs -f app
docker compose logs -f whisper
docker compose logs -f ollama
```

## If Something Looks Stuck

Check running containers:

```bash
docker compose ps
```

Check the backend health:

```bash
curl http://127.0.0.1:8743/api/health
```

Rebuild only the app after code changes:

```bash
docker compose build app
docker compose up -d app
```

Reset everything, including notes and downloaded models:

```bash
docker compose down -v
```

Use reset only when you really want to delete local data.

## Frontend Development

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to the Docker app on `http://127.0.0.1:8743` (change `APP_PORT` in `.env` if you use another host port, and point the proxy at the same port).

## What It Does

- Records audio in the browser.
- Sends audio to Dockerized `whisper.cpp`.
- Uses Ollama to summarize and categorize the note.
- Stores notes in SQLite.
- Stores note embeddings in Qdrant.
- Lets you ask questions against previous notes.

For a beginner-friendly explanation of these pieces, read:

```text
docs/how-it-works-for-beginners.md
```

## Network access (LAN and router)

By default Compose maps **`0.0.0.0:8743`** → the app (container port **8000**), so other devices on your LAN can open `http://<this-machine-ip>:8743`. The host port is **`APP_PORT`** (default **8743**); change it in `.env` if that port is taken.

- **Router port forwarding:** forward your chosen **WAN TCP port** to this machine’s **LAN IP** and **`APP_PORT`** (e.g. 8743). Use only on networks you trust; this stack is not hardened for the public internet.
- **CORS:** Browsing the UI from a **LAN IP** + port works same-origin. For split dev (e.g. Vite vs API origins), set **`CORS_LAN_ORIGINS=true`** to allow RFC1918 origins on `PUBLIC_APP_PORT`, or set **`CORS_ORIGINS`** explicitly (see `.env.example`).
- **Localhost-only again:** set **`APP_HOST_BIND=127.0.0.1`** in `.env`.

### Microphone from LAN or internet

Browsers allow the **microphone only in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)**. That includes **`https://`** origins and **`http://localhost`** / **`http://127.0.0.1`** — **not** plain **`http://`** with a LAN IP or public hostname, so **`http://203.0.113.50:8743` will not get mic permission**.

To capture audio remotely you need **`https://`** in front of the stack, for example:

- **TLS reverse proxy:** Caddy or nginx on **443** with a certificate, proxying to **`APP_PORT`**. Automated certs (Let’s Encrypt) normally require a **domain** pointed at your home network.
- **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)** (or a similar HTTPS tunnel): you get **`https://…`** without punching a WAN hole to plain HTTP **8743**; TLS ends at Cloudflare while the tunnel reaches your local app.

Typing notes, uploads, Ask, WebSockets, and notifications still work over HTTP where the backend allows it; **only in-browser microphone capture requires HTTPS** (unless the user stays on localhost).

## Local-only and exposure

The process still listens on **all interfaces inside the container** (`0.0.0.0:8000`). Whether the **host** accepts remote connections is controlled by **`APP_HOST_BIND`** (default **`0.0.0.0`** for LAN reachability). Tighten it to **`127.0.0.1`** if you only want this machine. HMAC-related env vars in `.env.example` are reserved for future hardening.

## Models

Defaults (override in `.env` or Compose):

- Whisper: `small.en` (`WHISPER_MODEL`)
- Chat: `gemma2:2b`
- Embeddings: `nomic-embed-text`

Change these before starting the stack if you want different models.

Only the **Note Keeper** service is published on the host (`APP_HOST_BIND` / `APP_PORT`). Ollama, Qdrant, and Whisper stay on Docker’s internal network unless you change Compose.
