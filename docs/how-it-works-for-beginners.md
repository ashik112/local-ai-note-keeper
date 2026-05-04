# How This AI Note Keeper Works

This document explains the app in plain language. No AI background needed.

## The Big Idea

You talk into the browser. The app turns your voice into text, cleans it up, saves it, and lets you ask questions about what you saved before.

Example:

1. You say: "Store my office ID number as 12345."
2. The app transcribes it into text.
3. The app recognizes it as a personal ID-style note.
4. The app saves it.
5. Later you ask: "What is my office ID number?"
6. The app searches old notes and answers from your saved memory.

Everything runs locally in Docker. Your notes are not sent to OpenAI, Google, or any cloud AI service.

## Main Pieces

### Browser UI

This is the page you open at:

```text
http://127.0.0.1:3000
```

(When you run the stack with Docker Compose, the app maps that address to the backend, which serves the built frontend.)

The screen is organized into three main areas in the bottom navigation:

- **Notes** — search and filter your saved notes, open a note to read the brief, extracts, and full transcript.
- **Capture** — record voice to create a new note. You see status (Listening, Uploading, and so on) and an optional **live preview** of what the browser thinks you said. This tab does **not** show the typed question box or the Ask-style answer panel; those belong on **Ask** only.
- **Ask** — type a question or use the mic to ask about notes you already saved. You see the composer, the answer, and source notes when the model uses them.

Other UI details you might notice:

- **Auto-stop after silence** — optional setting on Capture and Ask that stops recording after about five seconds of quiet (after you have already spoken), so you do not have to tap stop every time.
- **Category filter** — on Notes, a pill control filters the list by category.

The frontend is built with React and Vite. React helps build the interactive screen. Vite builds the frontend files quickly.

The app also uses small UI helper libraries:

- shadcn-style components for clean buttons, cards, inputs, and layout
- lucide icons for familiar symbols like microphone, search, and notes
- simple animations so recording, loading, and note changes feel alive

These libraries are used so the app feels like a real product without building every UI part by hand.

### Backend

The backend is the coordinator.

It receives audio and text from the browser, sends audio to Whisper when needed, sends text to Ollama for AI work, saves notes in SQLite, and stores searchable memory in Qdrant.

The backend is written with FastAPI because it is simple, readable, and good for APIs.

The backend exposes important routes such as:

- `POST /api/notes/audio` — save a note from recorded audio (returns a `job_id` to poll)
- `POST /api/notes/text` — save a note from text you already have (also returns a `job_id`)
- `POST /api/ask` — ask a question with **typed** text (returns the answer directly in one response)
- `POST /api/ask/audio` — ask a question with **recorded** audio (returns a `job_id`)
- `GET /api/jobs/{job_id}` — check progress of a queued job (transcription, note creation, or voice ask)
- `GET /api/notes` — list notes (supports `category` and `q` query parameters)
- `GET /api/notes/{note_id}` — fetch one note
- `PATCH /api/notes/{note_id}` — update fields like title or category
- `DELETE /api/notes/{note_id}` — delete a note and try to remove its vector from Qdrant
- `GET /api/health` — simple status and which models are configured

There is **no** live WebSocket transcription endpoint in the current backend. Live text on the screen comes from the **browser’s** speech preview, not from streaming chunks to Whisper.

### Whisper

Whisper is the speech-to-text part.

It answers this question:

```text
What did the user say in the recording?
```

In this project, Whisper runs through `whisper.cpp` inside Docker and exposes an HTTP `/inference` endpoint that the backend calls with the uploaded audio file.

Why `whisper.cpp`?

- It is lighter than running the full Python Whisper package.
- It works well locally.
- It can run without cloud services.
- It is a good fit for a private local app.

Default model in Docker Compose:

```text
small.en
```

(You can change this with `WHISPER_MODEL` when building or running the Whisper service.)

Why `small.en`?

- It is more accurate than `base.en`.
- It is still small enough for a laptop.
- It is a reasonable default for English-focused use.

#### Browser preview vs Whisper

While you record, the app can show **live preview** text using the browser’s **Web Speech API** (where the browser supports it). That text is a **hint** for you on screen. It is **not** the same engine as Whisper.

When you stop recording:

1. The browser uploads the recorded audio to the backend (as a normal file upload).
2. The browser can also send the preview text as a form field called `browser_transcript`.
3. If that hint is long enough, the backend may **skip Whisper** and use the hint as the transcript (this saves time and compute). If the hint is short or empty, the backend runs **Whisper inference** on the uploaded file.

After the job finishes, the backend **deletes the uploaded audio file** from disk so recordings do not pile up forever in the uploads folder.

### Ollama

Ollama runs local AI models.

In this app, Ollama does two jobs:

- chat/reasoning with `gemma2:2b` (configurable)
- embeddings with `nomic-embed-text` (configurable)

Think of Ollama as the local AI engine.

### What "Inference" Means (and "Interference")

People sometimes mix up **inference** with **interference**. They sound similar but mean different things.

**Inference** (this app does a lot of it):

- Inference means: **use a trained model to produce an output from new input**.
- Examples in this project:
  - Whisper **infers** text from your audio.
  - The chat model **infers** a title, summary, categories, and answers from text you give it.
  - The embedding model **infers** a vector of numbers from a sentence.

You can think of training as "teaching the model once." Inference is "asking the already-trained model a question" many times as you use the app.

**Interference** (not what the AI steps are called):

- Interference usually means signals getting in each other’s way (for example radio noise) or two processes clashing.
- That is a normal English word, but it is **not** the standard name for "running the model."

So when docs say Whisper or Ollama is doing inference, they mean **running the AI model**, not electromagnetic interference.

### Chat Model

The chat model is the model that reads text and writes useful text back.

In this app, the chat model:

- creates a title
- summarizes the note
- chooses a category (with rules so simple errands like buying a ticket are more likely labeled **Task** than **Project**, and similar disambiguation)
- extracts key points
- extracts action items
- answers questions from stored notes

Default model:

```text
gemma2:2b
```

Why this model?

- It is small enough for local use.
- It is good enough for note cleanup and simple reasoning.
- It keeps the first version practical on a laptop.

The app can ask Ollama to **keep models loaded** for a short time after use so repeated captures feel snappier. The exact value comes from the environment:

```text
OLLAMA_KEEP_ALIVE
```

In `docker-compose.yml` this is often set to `10m`. If you run the backend without that override, the code default may be shorter (`1m`). Either way: higher values use more RAM while idle but reduce cold-start delay.

### Embedding Model

An embedding model turns text into a list of numbers.

That sounds strange, but the idea is simple:

```text
"My office ID is 12345" -> [0.12, -0.44, 0.91, ...]
```

Those numbers represent the meaning of the text.

Texts with similar meaning get similar number patterns.

Example:

- "My office ID is 12345"
- "I forgot my employee number"

These do not use the same exact words, but they are related. Embeddings help the app understand that relationship.

Why do we need embeddings?

Normal search only matches words. If you search for "employee number", normal text search may miss a note that says "office ID".

Embedding search is meaning-based. It can find notes that are conceptually related even when the words are different.

Default embedding model:

```text
nomic-embed-text
```

Why this model?

- It runs locally in Ollama.
- It is made for turning text into searchable vectors.
- It keeps the system Docker-friendly.

The embedding model does not write summaries or answer questions by itself in the conversational sense. Its main job here is **inference**: convert text into vectors for similarity search.

### Vector Database

A vector database stores embeddings and searches by meaning.

This app uses Qdrant.

Qdrant answers this question:

```text
Which old notes are closest in meaning to this new question?
```

Example:

1. You ask: "What is my ID number?"
2. The app turns that question into numbers using the embedding model (embedding **inference**).
3. Qdrant compares those numbers against saved note numbers.
4. Qdrant returns the most related notes.
5. The chat model uses those notes to answer (chat **inference**).

Why Qdrant?

- It is made for vector search.
- It runs locally in Docker.
- It is more appropriate than trying to build vector search ourselves.

### SQLite

SQLite stores the normal note data:

- transcript
- title
- summary
- category
- key points
- action items
- created date
- and other fields like sensitivity and links to vectors

Why SQLite?

- It is simple.
- It is built for local apps.
- It does not need a separate database server.
- It is enough for a single-user personal note keeper.

SQLite stores the full note. Qdrant stores the meaning-search version.

## What Happens When You Save A Voice Note (Capture)

Here is the current full flow:

1. Browser asks for microphone access.
2. Browser records with `MediaRecorder` into a short audio file (for example WebM).
3. While recording, the browser may run **Web Speech API** preview and show text on screen. That is optional and depends on the browser.
4. When you stop, the browser uploads the audio to `POST /api/notes/audio`. It can attach `browser_transcript` from the preview when it is available.
5. Backend saves the file temporarily, creates a **job**, and returns `job_id`.
6. The single worker picks up the job.
7. If `browser_transcript` is long enough, the worker uses it as the transcript and **skips Whisper**. Otherwise the worker calls Whisper `/inference` on the file.
8. Worker sets state to **analyzing** and asks the **chat model** to structure the note (title, summary, category, and so on).
9. Worker sets state to **embedding** and runs the **embedding model** on a text bundle built from the note.
10. SQLite saves the note. Qdrant stores the vector.
11. Worker marks the job **stored** and **deletes the temporary upload file**.
12. The UI polls `GET /api/jobs/{job_id}` until the job finishes, then refreshes the note list.

So: Whisper may not run at all if the browser preview text was good enough. If Whisper runs, that step is **batch inference** on the whole clip, not word-by-word streaming.

## Why There Is Still A Recorded File

Live preview depends on the browser and the Web Speech API.

Whisper depends on Docker and the Whisper service.

If preview fails or is too short, the backend still has the **uploaded recording** to transcribe with Whisper.

If preview works well, you get faster saves because Whisper can be skipped.

The user experience should not break just because preview failed.

## What Happens When You Ask A Question

There are two paths.

### Typed question (`POST /api/ask`)

1. You type a question and submit.
2. Backend embeds the question, searches Qdrant, loads top notes from SQLite.
3. Chat model answers using only those notes.
4. Response returns immediately with `answer` and `sources` (no job polling on this path).

### Voice question (`POST /api/ask/audio`)

1. Same recording and preview pattern as Capture.
2. Job is created; browser polls job status.
3. Short browser hint can skip Whisper for the **question**; otherwise Whisper transcribes the clip.
4. Then the same search + answer steps run as for a typed question.
5. Result is attached to the job when state is **stored**.

Example:

1. Earlier you saved: "Store my office ID number as 12345."
2. Later you ask: "I forgot my ID number."
3. The app searches by meaning, not only exact words.
4. Qdrant finds the old note about your office ID.
5. Ollama answers using that note.

This is the "memory" part of the app.

## How Categories And Key Notes Work

When a note is saved, the backend asks the chat model to return structured information.

The app asks for:

- title
- summary
- category
- key points
- action items
- important names or entities
- sensitivity level

The category controls the color in the UI.

Examples:

- Work notes use blue.
- Meeting notes use purple.
- Project notes use green.
- Credential or ID notes use red.

The color does not change the AI logic. It only helps you scan your notes faster.

The prompt also nudges the model so **Task** fits one-off errands (buy a ticket, book something) and **Project** fits bigger multi-step work, because users expect those labels to feel sensible in daily life.

## Why There Is A Queue

AI work can be heavy.

Whisper and Ollama can both use a lot of CPU/RAM. If the app tried to process many recordings at once, your laptop could get slow.

So the backend processes **audio and long-running note jobs** one at a time for those job types.

This is slower for bulk uploads, but better for a MacBook-style local app.

The queue also gives each job a clear status:

- `queued`: waiting
- `transcribing`: turning audio into text (or using a long browser hint instead)
- `analyzing`: summarizing and categorizing
- `embedding`: creating the memory-search vector
- `stored`: saved successfully
- `answering`: working on a voice question
- `failed`: something went wrong

The frontend polls `GET /api/jobs/{job_id}` on a short interval so the screen can update while the worker runs.

## Why Docker

Docker packages the app into services that are easier to run.

Instead of manually installing Python packages, Qdrant, Ollama, and Whisper tools, you can run:

```bash
docker compose up --build
```

Docker starts the pieces together.

The tradeoff:

- easier setup
- more disk usage
- first boot takes longer because images and models download

In this app, Docker starts:

- app backend and built frontend
- Whisper service
- Ollama service
- Qdrant service

The frontend is built into static files and served by the FastAPI app, so you only open one local URL.

Persistent data uses Docker volumes (for example app data, uploads, and model caches).

## Why Only The App Port Is Exposed

Only this URL is exposed to your Mac by default:

```text
http://127.0.0.1:3000
```

Ollama, Qdrant, and Whisper stay inside Docker's private network.

Why?

- fewer port conflicts
- smaller local attack surface
- cleaner setup

## What "Local Only" Means

Local only means:

- browser talks to your local backend
- backend talks to local Docker services
- AI models run locally
- notes are stored locally

It does not mean "zero resource usage." While Docker services are running, they use some memory and disk.

It also does not mean "ready for the public internet." Right now the app is intended for local use on your own machine.

If external access is added later, the app should use proper authentication and any shared secrets from the env setup so outside requests cannot freely read private notes.

## Important Limitation

Whisper is inside Docker right now because that was the chosen setup.

On Apple Silicon, Dockerized Whisper may not use the best Mac-native acceleration. It works, but native macOS Whisper could be faster later.

For now, Docker keeps setup simpler.

Another limitation: the **live preview** is browser speech recognition when available. It can differ from Whisper’s transcript. The saved note always goes through the backend path (hint or Whisper) and then the chat model’s cleanup, so the stored version is the one the pipeline decided to use.

## Mental Model

Think of the app like this:

- Browser: microphone, optional live preview, and screen
- Backend: manager, job queue, and file handling
- Whisper: ears when you need cloud-grade transcription from the audio file
- Chat model: writer and reasoner
- Embedding model: meaning converter for search
- Qdrant: memory index
- SQLite: notebook

The backend ties them together.

Together, **inference** is just: each of those models **running on your inputs** to produce text, structure, or vectors — step by step, mostly on your own machine.
