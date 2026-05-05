# AI Coding Rules

Use these rules when changing this project later.

## Product Direction

- Keep the app local-first and Docker-ready.
- Keep the first screen as the usable note tool, not a landing page.
- Keep Capture mode and Ask mode clear in the UI.
- Keep Whisper inside Docker unless the user explicitly changes that decision.
- Keep external access disabled by default.

## Code Style

- Prefer plain, readable code over clever abstractions.
- Use existing libraries for framework work: FastAPI for API, browser APIs for recording, SQLite for simple local storage, Qdrant for vectors, Ollama for local models.
- Do not add a new framework unless it removes real complexity.
- Keep functions short and named after what the user would understand.
- Add comments only where they explain a non-obvious decision.
- Avoid jargon in user-facing text.

## Backend Structure

- `backend/app/main.py` owns HTTP routes.
- `backend/app/jobs.py` owns queue and long-running work.
- `backend/app/ai.py` owns Whisper and Ollama calls.
- `backend/app/vector_store.py` owns Qdrant calls.
- `backend/app/database.py` owns SQLite reads and writes.
- Do not put model prompts, database SQL, and route handlers in the same file.

## Frontend Structure

- Keep the frontend in `frontend/` as a Vite React app.
- Use shadcn-style local components from `frontend/src/components/ui/`.
- Use lucide-react for icons.
- Use framer-motion for small purposeful transitions.
- Keep API calls close to the UI until duplication becomes real.
- Do not add a state-management library unless local React state becomes painful.
- Keep the built frontend served by FastAPI from `/app/static`.

## Data Rules

- Store full transcripts in SQLite.
- Store vectors and small metadata in Qdrant.
- Do not store full transcripts inside Qdrant payloads.
- Mark credentials and IDs as sensitive when the model detects them.
- Ask mode must answer from stored notes and say when no matching memory exists.

## Docker Rules

- `make up-build` (or equivalently `docker compose up --build`) must remain a supported first-boot path for the stack.
- Default Compose maps the app to `APP_HOST_BIND` / `APP_PORT` (see `.env.example`; LAN bind is opt-out via `APP_HOST_BIND=127.0.0.1`).
- Persist models and app data in Docker volumes.
- Keep `.env.example` complete when adding settings.

## Testing Rules

- Run Python syntax checks after backend edits.
- Run a Docker config check after Compose edits.
- Prefer small tests around parsing, storage, and API behavior before adding broad test suites.
