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

It lets you:

- record a note
- ask a question
- see stored notes
- inspect summaries, key points, action items, and transcripts

The frontend is built with React and Vite. React helps build the interactive screen. Vite builds the frontend files quickly.

The app also uses small UI helper libraries:

- shadcn-style components for clean buttons, cards, inputs, and layout
- lucide icons for familiar symbols like microphone, search, and notes
- simple animations so recording, loading, and note changes feel alive

These libraries are used so the app feels like a real product without building every UI part by hand.

### Backend

The backend is the coordinator.

It receives audio and text from the browser, sends audio to Whisper for transcription, sends text to Ollama for AI work, saves notes in SQLite, and stores searchable memory in Qdrant.

The backend is written with FastAPI because it is simple, readable, and good for APIs.

The backend exposes a few important routes:

- `POST /api/notes/audio`: save a note from recorded audio
- `POST /api/notes/text`: save a note from already-transcribed text
- `POST /api/ask/text`: ask a question using typed text
- `POST /api/ask/audio`: ask a question using recorded audio
- `GET /api/notes`: show saved notes
- `WS /api/ws/transcribe`: send live microphone audio and receive live text previews

### Whisper

Whisper is the speech-to-text part.

It answers this question:

```text
What did the user say in the recording?
```

In this project, Whisper runs through `whisper.cpp` inside Docker.

Why `whisper.cpp`?

- It is lighter than running the full Python Whisper package.
- It works well locally.
- It can run without cloud services.
- It is a good fit for a private local app.

Default model:

```text
small.en
```

Why `small.en`?

- It is more accurate than `base.en`.
- It is still small enough for a laptop.
- The app now starts transcription while you are still talking, so the slower model hurts less.

Important detail:

The current Dockerized Whisper server supports normal audio transcription through `/inference`. It does not expose a true `/stream` endpoint in this setup.

So the app uses a practical live preview approach:

1. The browser sends small audio chunks to the backend over a WebSocket.
2. The backend keeps a short growing audio buffer.
3. Every few seconds, the backend asks Whisper to transcribe the current buffer.
4. The backend sends the latest transcript back to the browser.

This gives you live text while recording, even though the underlying Whisper container is still using normal transcription requests.

### Ollama

Ollama runs local AI models.

In this app, Ollama does two jobs:

- chat/reasoning with `gemma2:2b`
- embeddings with `nomic-embed-text`

Think of Ollama as the local AI engine.

### Chat Model

The chat model is the model that reads text and writes useful text back.

In this app, the chat model:

- creates a title
- summarizes the note
- chooses a category
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

The app keeps the model warm for a short time after it answers.

Current setting:

```text
OLLAMA_KEEP_ALIVE=10m
```

That means Ollama can keep the model loaded for about 10 minutes after use. This uses more memory while active, but it avoids repeated cold starts when you are capturing several notes in a row.

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

The embedding model does not write summaries or answer questions. Its job is only to convert text into a meaning-based number format for search.

### Vector Database

A vector database stores embeddings and searches by meaning.

This app uses Qdrant.

Qdrant answers this question:

```text
Which old notes are closest in meaning to this new question?
```

Example:

1. You ask: "What is my ID number?"
2. The app turns that question into numbers using the embedding model.
3. Qdrant compares those numbers against saved note numbers.
4. Qdrant returns the most related notes.
5. The chat model uses those notes to answer.

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

Why SQLite?

- It is simple.
- It is built for local apps.
- It does not need a separate database server.
- It is enough for a single-user personal note keeper.

SQLite stores the full note. Qdrant stores the meaning-search version.

## What Happens When You Save A Voice Note

Here is the current full flow:

1. Browser asks for microphone access.
2. Browser starts recording with `MediaRecorder` as a safe backup.
3. Browser also sends live audio chunks to `WS /api/ws/transcribe`.
4. Backend sends those chunks to Whisper in short snapshots.
5. UI shows a live transcript while you are talking.
6. When you stop, the browser checks if the live transcript is usable.
7. If live text exists, browser sends it to `POST /api/notes/text`.
8. If live text failed or is empty, browser uploads the recorded audio to `POST /api/notes/audio`.
9. Backend puts the job in a queue.
10. Ollama summarizes and categorizes the text.
11. Ollama embedding model turns the note into numbers.
12. SQLite saves the real note.
13. Qdrant saves the vector for memory search.
14. The UI shows the saved note.

This is why stopping a recording should feel faster now. Most transcription work already happened while you were talking.

## Why There Is A Fallback Recording

Live transcription depends on browser audio, a WebSocket, the backend, and Whisper all working together.

If any part of the live path fails, the app still has the normal recorded audio from `MediaRecorder`.

That means:

- best case: live transcript is used, and saving is faster
- fallback case: audio is uploaded after stop, and the note still saves

The user experience should not break just because live preview failed.

## What Happens When You Ask A Question

Here is the full flow:

1. You ask a question.
2. Ollama embedding model turns the question into numbers.
3. Qdrant finds related old notes.
4. Backend loads those full notes from SQLite.
5. Ollama chat model answers using those notes.
6. UI shows the answer and the source notes.

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

## Why There Is A Queue

AI work can be heavy.

Whisper and Ollama can both use a lot of CPU/RAM. If the app tried to process many recordings at once, your laptop could get slow.

So the backend processes AI jobs one at a time.

This is slower for bulk uploads, but better for a MacBook-style local app.

The queue also gives each job a clear status:

- `queued`: waiting
- `transcribing`: turning audio into text
- `analyzing`: summarizing and categorizing
- `embedding`: creating the memory-search vector
- `stored`: saved successfully
- `answering`: answering a question
- `failed`: something went wrong

The frontend checks job status often so the screen can update quickly.

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

## Why Only The App Port Is Exposed

Only this URL is exposed to your Mac:

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

If external access is added later, the app should use the HMAC keys from the env setup so outside requests can be verified before they reach private notes.

## Important Limitation

Whisper is inside Docker right now because that was the chosen setup.

On Apple Silicon, Dockerized Whisper may not use the best Mac-native acceleration. It works, but native macOS Whisper could be faster later.

For now, Docker keeps setup simpler.

Another limitation: the current live transcript is a preview. Because Whisper is being called with growing audio snapshots, the text may update or change as you keep speaking. The final saved note still goes through Ollama cleanup before being stored.

## Mental Model

Think of the app like this:

- Browser: microphone and screen
- Backend: manager
- Whisper: ears
- Chat model: writer and reasoner
- Embedding model: meaning converter
- Qdrant: memory index
- SQLite: notebook

The backend ties them together.
