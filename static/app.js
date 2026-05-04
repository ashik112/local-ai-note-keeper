const state = {
  mode: "capture",
  mediaRecorder: null,
  audioChunks: [],
  notes: [],
};

const elements = {
  systemStatus: document.querySelector("#systemStatus"),
  captureModeButton: document.querySelector("#captureModeButton"),
  askModeButton: document.querySelector("#askModeButton"),
  modeTitle: document.querySelector("#modeTitle"),
  modeHint: document.querySelector("#modeHint"),
  recordButton: document.querySelector("#recordButton"),
  stopButton: document.querySelector("#stopButton"),
  recordingStatus: document.querySelector("#recordingStatus"),
  textQuestion: document.querySelector("#textQuestion"),
  askTextButton: document.querySelector("#askTextButton"),
  resultBox: document.querySelector("#resultBox"),
  refreshNotesButton: document.querySelector("#refreshNotesButton"),
  categoryFilter: document.querySelector("#categoryFilter"),
  noteSearch: document.querySelector("#noteSearch"),
  notesList: document.querySelector("#notesList"),
  noteDialog: document.querySelector("#noteDialog"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogMeta: document.querySelector("#dialogMeta"),
  dialogSummary: document.querySelector("#dialogSummary"),
  dialogKeyPoints: document.querySelector("#dialogKeyPoints"),
  dialogActionItems: document.querySelector("#dialogActionItems"),
  dialogTranscript: document.querySelector("#dialogTranscript"),
};

function setMode(mode) {
  state.mode = mode;
  elements.captureModeButton.classList.toggle("active", mode === "capture");
  elements.askModeButton.classList.toggle("active", mode === "ask");
  elements.modeTitle.textContent = mode === "capture" ? "Capture a note" : "Ask your memory";
  elements.modeHint.textContent =
    mode === "capture"
      ? "Record something to store, categorize, summarize, and remember."
      : "Ask about stored notes. Answers are based on your saved memories.";
}

async function checkHealth() {
  try {
    const health = await fetchJson("/api/health");
    elements.systemStatus.textContent = `Local · ${health.chat_model} · ${health.embedding_model}`;
  } catch (error) {
    elements.systemStatus.textContent = "Backend is not ready.";
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);

    state.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    });

    state.mediaRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      await uploadRecording();
    });

    state.mediaRecorder.start();
    elements.recordButton.disabled = true;
    elements.stopButton.disabled = false;
    elements.recordingStatus.textContent = "Recording";
  } catch (error) {
    showResult(`Could not start recording: ${error.message}`);
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
  elements.recordButton.disabled = false;
  elements.stopButton.disabled = true;
  elements.recordingStatus.textContent = "Uploading";
}

async function uploadRecording() {
  try {
    const audio = new Blob(state.audioChunks, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("file", audio, `${state.mode}-${Date.now()}.webm`);

    const endpoint = state.mode === "capture" ? "/api/notes/audio" : "/api/ask/audio";
    const job = await postForm(endpoint, formData);
    await watchJob(job.job_id);
  } catch (error) {
    elements.recordingStatus.textContent = "Failed";
    showResult(`Upload failed: ${error.message}`);
  } finally {
    elements.recordButton.disabled = false;
    elements.stopButton.disabled = true;
  }
}

async function watchJob(jobId) {
  showResult("Queued");

  while (true) {
    const job = await fetchJson(`/api/jobs/${jobId}`);
    elements.recordingStatus.textContent = job.message;
    showResult(job.error ? `Error: ${job.error}` : job.message);

    if (job.state === "failed") {
      return;
    }

    if (job.state === "stored") {
      renderJobResult(job.result);
      await loadNotes();
      return;
    }

    await wait(1200);
  }
}

async function askTextQuestion() {
  const question = elements.textQuestion.value.trim();
  if (!question) {
    showResult("Write a question first.");
    return;
  }

  try {
    showResult("Searching memory");
    const result = await postJson("/api/ask", { question });
    renderAskResult(result);
  } catch (error) {
    showResult(`Ask failed: ${error.message}`);
  }
}

function renderJobResult(result) {
  if (result.note) {
    const note = result.note;
    showResult(`Saved: ${note.title}\n\n${note.summary}`);
    return;
  }
  renderAskResult(result);
}

function renderAskResult(result) {
  const sourceTitles = (result.sources || []).map((note) => `- ${note.title}`).join("\n");
  showResult(`${result.answer}\n\nSources:\n${sourceTitles || "No matching notes."}`);
}

async function loadNotes() {
  try {
    const params = new URLSearchParams();
    if (elements.categoryFilter.value) {
      params.set("category", elements.categoryFilter.value);
    }
    if (elements.noteSearch.value.trim()) {
      params.set("q", elements.noteSearch.value.trim());
    }

    const data = await fetchJson(`/api/notes?${params.toString()}`);
    state.notes = data.notes;
    renderNotes();
  } catch (error) {
    elements.notesList.innerHTML = `<p class="empty-state">Could not load notes: ${escapeHtml(error.message)}</p>`;
  }
}

function renderNotes() {
  elements.notesList.innerHTML = "";

  if (state.notes.length === 0) {
    elements.notesList.innerHTML = '<p class="empty-state">No notes yet.</p>';
    return;
  }

  for (const note of state.notes) {
    const card = document.createElement("button");
    card.className = "note-card";
    card.type = "button";
    card.innerHTML = `
      <h3>${escapeHtml(note.title)}</h3>
      <p>${escapeHtml(note.summary)}</p>
      <div class="badge-row">
        <span class="badge">${escapeHtml(note.category)}</span>
        <span class="badge ${note.sensitivity !== "normal" ? "sensitive" : ""}">${escapeHtml(note.sensitivity)}</span>
      </div>
    `;
    card.addEventListener("click", () => openNote(note));
    elements.notesList.appendChild(card);
  }
}

function openNote(note) {
  elements.dialogTitle.textContent = note.title;
  elements.dialogMeta.textContent = `${note.category} · ${new Date(note.created_at).toLocaleString()}`;
  elements.dialogSummary.textContent = note.summary;
  fillList(elements.dialogKeyPoints, note.key_points);
  fillList(elements.dialogActionItems, note.action_items);
  elements.dialogTranscript.textContent = note.transcript;
  elements.noteDialog.showModal();
}

function fillList(element, values) {
  element.innerHTML = "";
  const items = values && values.length ? values : ["None"];
  for (const value of items) {
    const item = document.createElement("li");
    item.textContent = value;
    element.appendChild(item);
  }
}

function showResult(message) {
  elements.resultBox.hidden = false;
  elements.resultBox.textContent = message;
}

async function fetchJson(url) {
  const response = await fetch(url);
  return parseResponse(response);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function postForm(url, body) {
  const response = await fetch(url, { method: "POST", body });
  return parseResponse(response);
}

async function parseResponse(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "Request failed.");
  }
  return data;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

elements.captureModeButton.addEventListener("click", () => setMode("capture"));
elements.askModeButton.addEventListener("click", () => setMode("ask"));
elements.recordButton.addEventListener("click", startRecording);
elements.stopButton.addEventListener("click", stopRecording);
elements.askTextButton.addEventListener("click", askTextQuestion);
elements.refreshNotesButton.addEventListener("click", loadNotes);
elements.categoryFilter.addEventListener("change", loadNotes);
elements.noteSearch.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadNotes, 250);
});

setMode("capture");
checkHealth();
loadNotes();
