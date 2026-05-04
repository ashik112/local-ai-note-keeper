# Local AI Note Keeper Plan

## Summary

Build a Docker-ready local web app for private voice notes. The user records speech in the browser, the system transcribes it with containerized `whisper.cpp`, categorizes the note, extracts key points, stores it, embeds it for long-term recall, and shows saved notes in the web interface.

The app has two primary interaction modes:

- **Capture mode:** "Store my passport number as ..." or general voice notes. The system saves structured notes and memories.
- **Ask mode:** "I forgot my ID number" or "What did I say about Agro Village last week?" The system searches previous notes and answers from stored local context.

Everything runs locally by default through Docker Compose. External access is not enabled for v1, but the config includes env placeholders for future HMAC-protected access.

## Goals

- Provide a browser UI for recording voice notes.
- Keep all AI processing local.
- Keep Whisper inside Docker for now, accepting that Apple ANE/Core ML acceleration may be limited compared with native macOS execution.
- Categorize each note automatically.
- Extract concise key notes/action items.
- Store original transcript, summary, category, metadata, and embeddings.
- Show stored notes in the web UI with search/filter support.
- Support memory-style Q&A over previous notes.
- Make startup simple: `docker compose up`.

## Non-Goals For V1

- No public deployment by default.
- No Cloudflare Tunnel enabled by default.
- No mobile app.
- No multi-user account system.
- No native macOS Whisper integration yet.
- No automatic background listening. Recording is user-initiated from the web UI.

## Architecture

### Services

Use Docker Compose with these services:

- **web:** Browser UI served by the app stack.
- **backend:** API and orchestration service.
- **whisper:** Containerized `whisper.cpp` transcription service.
- **ollama:** Local LLM and embedding host.
- **qdrant:** Vector database for semantic memory.
- **postgres** or **sqlite volume:** Durable note metadata store.

Recommended default for v1: **FastAPI backend + simple React/Vite frontend + Qdrant + Ollama + SQLite**. SQLite keeps the first version simpler while Qdrant handles semantic retrieval. Postgres can be added later if multi-user sync or heavier querying becomes necessary.

### Data Flow

1. User opens the local web UI.
2. User selects **Capture** or **Ask** mode.
3. Browser records audio and uploads it to the backend.
4. Backend creates a processing job and serializes AI work through a queue.
5. Backend sends audio to the `whisper` service.
6. Whisper returns transcript text.
7. Backend sends transcript to Ollama for:
   - category
   - title
   - key notes
   - action items
   - memory sensitivity label
8. Backend generates an embedding for the transcript and summary.
9. Backend stores:
   - raw transcript
   - normalized summary
   - category
   - extracted key notes
   - action items
   - timestamps
   - source audio metadata
   - vector ID
10. Backend stores the vector in Qdrant.
11. UI shows the processed note.

For **Ask mode**:

1. User types or records a question.
2. If audio, backend transcribes it first.
3. Backend embeds the question.
4. Backend searches Qdrant for relevant previous notes.
5. Backend sends the question plus retrieved notes to Ollama.
6. Backend returns an answer with references to the source notes used.

## Product Behavior

### Capture Mode

Capture mode stores durable notes and memories. It should handle short factual memory requests and longer rambly notes.

Examples:

- "Store my employee ID number as 12345."
- "Remember that Ibrahim still needs to finish the auth portal logic."
- "Today I discussed Agro Village budget risks with Mustafa."

For each capture, the system should produce:

- title
- transcript
- category
- key notes
- action items
- important entities
- optional reminder candidates
- confidence/status

### Ask Mode

Ask mode answers from stored notes only unless the UI clearly labels an answer as general reasoning.

Examples:

- "I forgot my ID number."
- "What did I say about Ibrahim's auth portal task?"
- "Summarize my Agro Village notes from this week."

Ask mode should:

- retrieve relevant notes from Qdrant
- answer with source-backed context
- show linked notes under the answer
- say when no relevant memory is found
- avoid inventing private facts

### Stored Notes View

The UI should include:

- chronological note list
- note detail panel
- category filter
- text search
- semantic search
- source transcript
- generated summary/key notes
- linked/relevant notes

### Categories

Start with a fixed but editable category set:

- Personal
- Work
- Project
- Task
- Credential or ID
- Meeting
- Journal
- Idea
- Finance
- Other

The LLM can suggest categories, but the backend should store categories as normalized values. Unknown categories map to `Other`.

## API Shape

### Local API

Use these backend endpoints:

- `POST /api/notes/audio`
  - Accepts audio upload.
  - Query/body field: `mode=capture`.
  - Returns job ID.

- `POST /api/ask/audio`
  - Accepts audio upload.
  - Query/body field: `mode=ask`.
  - Returns job ID.

- `POST /api/ask`
  - Accepts text question.
  - Returns answer and source notes.

- `GET /api/jobs/{id}`
  - Returns processing status and result.

- `GET /api/notes`
  - Supports pagination, category, date range, and text query.

- `GET /api/notes/{id}`
  - Returns one note with extracted fields and related notes.

- `PATCH /api/notes/{id}`
  - Allows editing title, category, summary, key notes, and action items.

- `DELETE /api/notes/{id}`
  - Deletes note metadata and matching vector.

### Future External API Protection

Keep the app local-only in v1, but include env placeholders for future signed requests:

```env
EXTERNAL_ACCESS_ENABLED=false
PUBLIC_BASE_URL=
HMAC_SECRET=
HMAC_HEADER_NAME=X-NoteKeeper-Signature
HMAC_TIMESTAMP_HEADER_NAME=X-NoteKeeper-Timestamp
HMAC_MAX_CLOCK_SKEW_SECONDS=300
```

When external access is enabled later, mutating requests should require an HMAC signature over:

- HTTP method
- path
- timestamp
- request body hash

## Storage Model

### Notes Table

Store one row per captured note:

- `id`
- `title`
- `transcript`
- `summary`
- `category`
- `key_points_json`
- `action_items_json`
- `entities_json`
- `sensitivity`
- `audio_filename`
- `vector_id`
- `created_at`
- `updated_at`

### Ask History Table

Store previous questions optionally:

- `id`
- `question`
- `answer`
- `source_note_ids_json`
- `created_at`

### Qdrant Collection

Collection: `notes`

Payload:

- `note_id`
- `title`
- `category`
- `summary`
- `created_at`
- `entities`
- `sensitivity`

Vector text should combine title, summary, key points, entities, and transcript excerpt. Full transcript remains in SQLite, not Qdrant payload.

## Model Choices

### Transcription

Use `whisper.cpp` in Docker for v1.

Recommended model:

- default: `base.en` or `small.en`
- fallback for lower memory: `tiny.en`

The app should mount models into a Docker volume so they are not downloaded every run.

### LLM

Use Ollama with a small local model:

- default: `gemma2:2b` or current small Gemma equivalent available locally
- higher quality option: `gemma2:9b` if the Mac has enough RAM

Set:

```env
OLLAMA_KEEP_ALIVE=1m
OLLAMA_NUM_PARALLEL=1
```

The backend should also pass request-level `keep_alive` where useful.

### Embeddings

Use an Ollama embedding model so the system stays Docker-simple.

Default:

- `nomic-embed-text`

Store the embedding model name in env:

```env
EMBEDDING_MODEL=nomic-embed-text
CHAT_MODEL=gemma2:2b
```

## Queue And Resource Rules

The backend should process AI jobs through a single-worker queue by default.

Rules:

- Never run Whisper and LLM-heavy summarization concurrently for multiple jobs by default.
- Allow multiple uploads, but process them sequentially.
- Job states: `queued`, `transcribing`, `analyzing`, `embedding`, `stored`, `failed`.
- Keep failed jobs inspectable in the UI.
- Add env-based concurrency later, defaulting to `1`.

```env
AI_WORKER_CONCURRENCY=1
MAX_AUDIO_SECONDS=600
MAX_UPLOAD_MB=100
```

## Docker Compose Requirements

The project should boot with:

```bash
docker compose up
```

Required volumes:

- app data
- uploaded audio
- Whisper models
- Ollama models
- Qdrant data

Required `.env.example` sections:

- app port
- local-only mode
- model names
- HMAC future config
- upload limits
- queue concurrency
- Qdrant/Ollama URLs

Default local URLs:

```env
APP_PORT=3000
BACKEND_PORT=8000
OLLAMA_URL=http://ollama:11434
QDRANT_URL=http://qdrant:6333
WHISPER_URL=http://whisper:8080
LOCAL_ONLY=true
```

## UI Plan

The first screen should be the actual note tool, not a landing page.

Primary layout:

- Top bar with app name, local status, model status.
- Left/main panel for recording and asking.
- Right/secondary panel for recent notes.
- Notes page or tab for full note library.

Controls:

- segmented control: Capture / Ask
- record button
- stop button
- text input fallback
- category filter
- search input
- note edit button
- delete button

States:

- idle
- recording
- uploading
- queued
- transcribing
- analyzing
- saved
- failed

The UI should make source-backed answers visible by linking answer snippets to stored notes.

## Security And Privacy

V1 default:

- bind app to localhost
- no public tunnel
- no authentication required for local use
- no cloud AI calls
- no telemetry

Future external mode:

- require `EXTERNAL_ACCESS_ENABLED=true`
- require `HMAC_SECRET`
- reject unsigned mutating requests
- recommend Cloudflare Access or another identity layer before public exposure

Sensitive categories like `Credential or ID` should be visually marked in the UI and excluded from casual summaries unless directly relevant to the user question.

## Implementation Milestones

### Milestone 1: Docker Skeleton

- Add Compose file.
- Add backend service.
- Add frontend service.
- Add Qdrant.
- Add Ollama.
- Add Whisper service.
- Add `.env.example`.
- Confirm `docker compose up` boots all services.

### Milestone 2: Capture Pipeline

- Implement browser audio recording.
- Upload audio to backend.
- Transcribe through Whisper container.
- Store transcript and metadata.
- Show saved notes.

### Milestone 3: AI Structuring

- Add Ollama categorization and summary prompts.
- Extract key points, action items, and entities.
- Normalize categories.
- Add editable note details.

### Milestone 4: Memory Retrieval

- Add embedding generation.
- Store vectors in Qdrant.
- Implement semantic related notes.
- Implement Ask mode with source-backed answers.

### Milestone 5: Local Hardening

- Add queue and job status UI.
- Add upload limits.
- Add failure handling.
- Add backup/export path for notes.
- Add HMAC env placeholders without enabling external access.

## Acceptance Criteria

- `docker compose up` starts the full local app.
- User can record audio in the browser.
- The app transcribes the audio using the Dockerized Whisper service.
- The app categorizes the note and extracts key notes.
- The note appears in the stored notes list.
- User can ask a question about previous notes.
- The answer uses retrieved stored notes and displays sources.
- User can explicitly store an ID number and later retrieve it via Ask mode.
- App remains local-only by default.
- `.env.example` includes future HMAC settings.

## Key Tradeoffs

- Keeping Whisper inside Docker improves setup consistency but likely gives up the best Apple-native ANE/Core ML performance.
- Docker Compose is easy to boot but does not create a true zero-footprint system while containers remain running.
- SQLite is enough for v1 and simpler than Postgres, but Postgres may be better if multi-user features appear later.
- HMAC config is included for future external access, but Cloudflare Access or another identity layer should still be used before public exposure.
