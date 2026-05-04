# UI/UX Overhaul Design

**Date:** 2026-05-05  
**Status:** Approved

## Goals

1. Live transcription text display while recording (Approach 3 — whisper WebSocket streaming)
2. Multiple colors — category color system + richer UI element colors
3. Better transcription quality — upgrade `base.en` → `small.en`, better audio capture
4. Reduce post-stop wait — transcription runs during recording, only Ollama analysis remains after stop

---

## Architecture

### Current capture flow

```
[stop mic] → upload webm → whisper batch → ollama → embed → store → poll 1200ms
              ↑ all of this happens after you stop talking
```

### New capture flow

```
[start mic] → AudioWorklet 16kHz PCM16 → WebSocket → whisper stream → live text display
[stop mic]  → accumulated transcript → POST /analyze → ollama → embed → store → poll 400ms
              ↑ transcription already done, only ollama remains after stop
```

Post-stop wait drops from `whisper + ollama` (~25–45s) to `ollama only` (~10–15s).

### Components changed

| Layer | Change |
|---|---|
| `frontend/src/App.tsx` | New `useWhisperStream` hook, `liveTranscript` state, 400ms poll, category colors, UI color improvements |
| `backend/app/main.py` | New `WS /api/ws/transcribe` (proxy to whisper), new `POST /api/notes/text` (skip transcription) |
| `backend/app/jobs.py` | New `analyze_text` job kind — ollama + embed + store, no whisper step |
| `docker-compose.yml` | `WHISPER_MODEL=small.en`, `OLLAMA_KEEP_ALIVE=10m` |
| `backend/requirements.txt` | Add `websockets` package (needed for FastAPI → whisper WS proxy) |

---

## Live Transcription

### WebSocket proxy (FastAPI)

```python
@app.websocket("/api/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):
    await websocket.accept()
    async with websockets_connect("ws://whisper:8080/stream") as whisper_ws:
        async def fwd_audio():
            async for chunk in websocket.iter_bytes():
                await whisper_ws.send(chunk)
        async def fwd_text():
            async for msg in whisper_ws:
                await websocket.send_text(msg)
        await asyncio.gather(fwd_audio(), fwd_text())
```

### AudioWorklet (frontend)

- `AudioContext` at native sample rate, mono
- `AudioWorkletProcessor` downsamples float32 → 16kHz via decimation, converts to Int16 PCM (multiply × 32767, clamp, pack as `Int16Array`)
- Sends binary WebSocket frames every ~100ms
- Whisper expects raw 16kHz PCM16 LE chunks

### `useWhisperStream` hook interface

```ts
const { liveTranscript, wsState, startStream, stopStream } = useWhisperStream();
// wsState: "idle" | "connecting" | "streaming" | "error"
// liveTranscript: string (accumulated from whisper segments, read from state)
// startStream(): opens WS + AudioContext
// stopStream(): closes WS + AudioContext; caller reads liveTranscript from state
```

### Live transcript display UX

- Appears below VoiceVisualizer in Capture tab only
- Scrollable, `max-h-[9rem]` (~6 lines)
- Text appends as whisper sends VAD segments (~1–3s lag behind speech)
- New segment flashes `text-foreground/90` then dims back to `text-primary/70` over 1s
- Stays visible after stop until Ollama result replaces it

### Fallback strategy

`MediaRecorder` (webm) runs in parallel at all times. If WebSocket fails:
- `wsState === "error"` or `liveTranscript` empty → fall back to existing `/api/notes/audio` upload flow
- User never sees a broken state — just loses live preview, still gets the note

### On-stop routing

| Condition | Action |
|---|---|
| `wsState === "streaming"`, transcript non-empty | POST to `/api/notes/text` — skip re-transcription |
| `wsState === "error"` or transcript empty | Upload MediaRecorder blob to `/api/notes/audio` |

### New backend endpoint

```
POST /api/notes/text
Body: { "transcript": "full accumulated text" }
Returns: { "job_id": "..." }
```

Queues `analyze_text` job: Ollama analysis → embed → store. No whisper step.

---

## Color System

### Category colors

| Category | Color | Hex |
|---|---|---|
| Personal | Amber | `#f59e0b` |
| Work | Blue | `#3b82f6` |
| Meeting | Purple | `#8b5cf6` |
| Project | Emerald | `#10b981` |
| Task | Orange | `#f97316` |
| Idea | Pink | `#ec4899` |
| Journal | Cyan | `#06b6d4` |
| Finance | Lime | `#84cc16` |
| Credential or ID | Red | `#ef4444` |
| Other | Gray | `#6b7280` |

Applied to: accent bar on note cards, detail view header top border, category badge.  
Implementation: `CATEGORY_COLORS` map in `App.tsx`, Tailwind arbitrary values or inline `style` prop.

Note card accent bar changes from `from-primary to-teal-500` gradient → solid `bg-[categoryColor]` at `opacity-80`.

### UI element colors

| Element / State | Color |
|---|---|
| Notes tab active | Blue `#3b82f6` |
| Capture tab active | Teal (existing primary) |
| Ask tab active | Purple `#8b5cf6` |
| Recording mic | Red pulse (existing destructive — no change) |
| Processing / uploading | Amber spinner |
| Done / stored | Green check flash |
| Live transcript text | Teal `text-primary/70`, brightens on new segment |
| Health chip (online) | Emerald |

---

## Performance + Audio Quality

### Poll interval
`watchJob`: `1200ms → 400ms`

### Ollama keep-alive
`docker-compose.yml`: `OLLAMA_KEEP_ALIVE=1m → 10m`  
Eliminates cold-start lag (15–30s) after idle period.

### Whisper model
`WHISPER_MODEL=base.en → small.en`  
~3× better accuracy, ~2–3× slower transcription — invisible to user since transcription runs during recording.  
One-time 466MB download on first container start after change.

### Audio capture

```ts
navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
});
```

`sampleRate` not constrained — AudioWorklet handles 16kHz resampling reliably across browsers.

---

## Out of scope

- Whisper streaming quality vs batch quality trade-off is accepted: `small.en` stream > `base.en` batch
- No SSE for analyze job — 400ms poll sufficient once transcription bottleneck is removed
- No UI changes to Ask tab or MemoryInspect beyond color system
