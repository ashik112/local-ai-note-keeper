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

## Quick start & commands

Requirements: **Docker Desktop** (or Docker Engine + Compose), enough disk for images and downloaded models.

```bash
make help
```

Typical flows (see **`Makefile`** for all targets):

| | |
|--|--|
| First run | **`make up-build`** — then open **`http://127.0.0.1:8743`** (override port via **`.env`**: **`APP_PORT`**) |
| Daily | **`make up`** / **`make down`** |
| Debugging | **`make ps`**, **`make health`**, **`make logs`**, **`make rebuild-app`** |
| Frontend dev against running API | **`make frontend-install`** once, then **`make frontend-dev`** |
| Tunnel (optional overlay) | **`make tunnel-up`** or **`make tunnel-quick`** after Cloudflare setup — **`docs/cloudflare-tunnel.md`** |

Destructive reset (deletes volumes / local data): **`make down-volumes`**.

Copy **`.env.example`** → **`.env`** when you change ports, models, or ingress-related settings.

First boot pulls models and builds `whisper.cpp`; it can take a while.

For a beginner-friendly architecture overview: **`docs/how-it-works-for-beginners.md`**.

## What it does

- Records audio in the browser.
- Sends audio to Dockerized `whisper.cpp`.
- Uses Ollama to summarize and categorize the note.
- Stores notes in SQLite and embeddings in Qdrant.
- Lets you ask questions against previous notes.

## Network access (LAN and router)

By default Compose maps **`0.0.0.0:8743`** → the app (**`APP_HOST_BIND`** / **`APP_PORT`** in **`.env`**). LAN devices use **`http://<machine-ip>:8743`**.

- **Router forwarding:** WAN TCP → this host’s **`APP_PORT`**. Trusted networks only — the API is not hardened for the open internet.
- **CORS:** Same-origin via the bundled UI on a LAN URL; for split origins see **`.env.example`** (**`CORS_LAN_ORIGINS`**, **`CORS_ORIGINS`**).
- **`APP_HOST_BIND=127.0.0.1`:** LAN cannot reach the host port directly.

### Microphone from LAN or internet

Browsers only grant the microphone in a **[secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)** (**`https://`** or **`http://localhost`** / **`127.0.0.1`**, not **`http://` + LAN/public hostname**).

Use **`https://`** in front of the stack (TLS proxy, tunnel, VPN with native mobile capture, etc.). Optional Cloudflare sidecars stay in **`docker-compose.cloudflare.yml`**; **`make tunnel-*`** merges that file — details in **`docs/cloudflare-tunnel.md`**.

Typing, uploads, Ask, WebSockets, and notifications still work over **`http://`** where the backend allows it; live **browser** mic capture over **`http://` + remote hostname does not.

## Local exposure

The API listens on **`0.0.0.0:8000` inside** the **`app`** container; the **host** listen address is **`APP_HOST_BIND`** (see **`.env.example`**).

## Models

Overrides in **`.env`**: Whisper **`WHISPER_MODEL`** (default **`small.en`**), **`CHAT_MODEL`**, **`EMBEDDING_MODEL`**.

Only the **`app`** service publishes **`APP_HOST_BIND` / `APP_PORT`** on the host. Ollama, Qdrant, and Whisper stay on the internal Compose network unless you change it.
