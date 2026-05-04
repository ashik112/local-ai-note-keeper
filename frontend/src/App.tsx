import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import { AssistantDeck } from "./note-keeper/AssistantDeck";
import { fetchJson, postForm, postJson, wait } from "./note-keeper/api";
import {
  STORAGE_SILENCE_AUTO_STOP,
  readSilenceAutoStopPref,
  SILENCE_AUTO_STOP_MS,
  SILENCE_RMS_THRESHOLD
} from "./note-keeper/constants";
import { FloatingDock } from "./note-keeper/FloatingDock";
import { MemoryInspect } from "./note-keeper/MemoryInspect";
import { MemoryLane } from "./note-keeper/MemoryLane";
import type { AskResult, Job, Mode, Note, Shell } from "./note-keeper/types";
import { useSpeechPreview } from "./note-keeper/useSpeechPreview";

export default function App() {
  const [shell, setShell] = useState<Shell>("capture");
  const [health, setHealth] = useState("…");
  const [isRecording, setIsRecording] = useState(false);
  const [activity, setActivity] = useState("Idle");
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<string>("");
  const [sources, setSources] = useState<Note[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [textPromptError, setTextPromptError] = useState("");
  const [silenceAutoStop, setSilenceAutoStop] = useState(readSilenceAutoStopPref);
  const [captureFeedback, setCaptureFeedback] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const silenceMonitorRef = useRef<{
    ctx: AudioContext | null;
    rafId: number | null;
    silenceStartedAt: number | null;
    heardVoice: boolean;
  }>({ ctx: null, rafId: null, silenceStartedAt: null, heardVoice: false });
  const { liveTranscript, speechPreviewState, startSpeechPreview, stopSpeechPreview, resetTranscript, peekBrowserTranscript } =
    useSpeechPreview();
  const browserDraftForUploadRef = useRef("");

  const stats = useMemo(() => {
    const sensitive = notes.filter((n) => n.sensitivity !== "normal").length;
    const tasks = notes.reduce((t, n) => t + n.action_items.length, 0);
    return { total: notes.length, sensitive, tasks };
  }, [notes]);

  const assistantMode = shell === "ask" ? "ask" : "capture";

  useEffect(() => {
    void checkHealth();
    void loadNotes();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void loadNotes(), 260);
    return () => window.clearTimeout(t);
  }, [category, search]);

  useEffect(() => {
    setTextPromptError("");
  }, [question, shell]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_SILENCE_AUTO_STOP, silenceAutoStop ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [silenceAutoStop]);

  useEffect(() => {
    if (!isRecording || !silenceAutoStop) {
      stopSilenceMonitor();
      return;
    }
    const stream = recordingStreamRef.current;
    if (!stream) return;
    startSilenceMonitor(stream);
    return () => {
      stopSilenceMonitor();
    };
  }, [isRecording, silenceAutoStop]);

  useEffect(() => {
    return () => {
      const m = silenceMonitorRef.current;
      if (m.rafId != null) {
        cancelAnimationFrame(m.rafId);
        m.rafId = null;
      }
      m.silenceStartedAt = null;
      m.heardVoice = false;
      const ctx = m.ctx;
      m.ctx = null;
      if (ctx && ctx.state !== "closed") void ctx.close();
    };
  }, []);

  function stopSilenceMonitor() {
    const m = silenceMonitorRef.current;
    if (m.rafId != null) {
      cancelAnimationFrame(m.rafId);
      m.rafId = null;
    }
    m.silenceStartedAt = null;
    m.heardVoice = false;
    const ctx = m.ctx;
    m.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  function startSilenceMonitor(stream: MediaStream) {
    stopSilenceMonitor();
    const audioContext = new AudioContext();
    silenceMonitorRef.current.ctx = audioContext;
    void audioContext.resume();

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.22;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);

    const tick = (now: number) => {
      const mon = silenceMonitorRef.current;
      if (!mon.ctx || mon.ctx !== audioContext) return;

      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);

      if (rms >= SILENCE_RMS_THRESHOLD) {
        mon.heardVoice = true;
        mon.silenceStartedAt = null;
      } else if (!mon.heardVoice) {
        mon.silenceStartedAt = null;
      } else if (mon.silenceStartedAt === null) {
        mon.silenceStartedAt = now;
      } else if (now - mon.silenceStartedAt >= SILENCE_AUTO_STOP_MS) {
        if (mediaRecorderRef.current?.state === "recording") {
          stopRecording();
        }
        return;
      }

      mon.rafId = requestAnimationFrame(tick);
    };

    silenceMonitorRef.current.rafId = requestAnimationFrame(tick);
  }

  async function checkHealth() {
    try {
      const data = await fetchJson<{ chat_model: string; embedding_model: string }>("/api/health");
      setHealth(`${data.chat_model} · ${data.embedding_model}`);
    } catch {
      setHealth("Unreachable");
    }
  }

  async function loadNotes() {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (search.trim()) params.set("q", search.trim());
    const data = await fetchJson<{ notes: Note[] }>(`/api/notes?${params.toString()}`);
    setNotes(data.notes);
    setSelectedNote((cur) => {
      if (cur && data.notes.some((n) => n.id === cur.id)) return cur;
      return data.notes[0] ?? null;
    });
  }

  function openNote(note: Note) {
    setSelectedNote(note);
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  async function startRecording() {
    try {
      resetTranscript();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      });

      recorder.addEventListener("stop", async () => {
        browserDraftForUploadRef.current = peekBrowserTranscript().trim();
        recordingStreamRef.current = null;
        stopSpeechPreview();
        stream.getTracks().forEach((tr) => tr.stop());
        await uploadRecording();
      });

      recorder.start(500);
      if (assistantMode === "capture" || assistantMode === "ask") {
        startSpeechPreview();
      }
      setIsRecording(true);
      setActivity("Listening");
      setResult("");
      setSources([]);
      setCaptureFeedback("");
    } catch (e) {
      recordingStreamRef.current = null;
      setActivity(e instanceof Error ? e.message : "Mic blocked");
    }
  }

  function stopRecording() {
    stopSilenceMonitor();
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setActivity("Uploading");
  }

  function toggleMic() {
    if (isWorking) return;
    if (isRecording) stopRecording();
    else void startRecording();
  }

  async function uploadRecording() {
    const audioMode = assistantMode;

    setIsWorking(true);
    try {
      const audio = new Blob(audioChunksRef.current, { type: "audio/webm" });
      if (audio.size < 256) {
        setActivity("Failed");
        if (audioMode === "capture") {
          setCaptureFeedback("Recording was too short or empty. Try again.");
        } else {
          setResult("Recording was too short or empty. Try again.");
        }
        browserDraftForUploadRef.current = "";
        return;
      }
      const form = new FormData();
      form.append("file", audio, `${assistantMode}-${Date.now()}.webm`);
      const draft = browserDraftForUploadRef.current.trim();
      if (draft.length > 0) {
        form.append("browser_transcript", draft);
      }
      browserDraftForUploadRef.current = "";
      const path = audioMode === "capture" ? "/api/notes/audio" : "/api/ask/audio";
      const job = await postForm<{ job_id: string }>(path, form);
      await watchJob(job.job_id, audioMode);
    } catch (e) {
      setActivity("Failed");
      const msg = e instanceof Error ? e.message : "Upload failed";
      if (audioMode === "capture") setCaptureFeedback(msg);
      else setResult(msg);
    } finally {
      setIsWorking(false);
    }
  }

  async function watchJob(jobId: string, audioMode: Mode) {
    for (;;) {
      const job = await fetchJson<Job>(`/api/jobs/${jobId}`);
      setActivity(job.message);

      if (job.state === "failed") {
        const msg = job.error ?? "Failed";
        if (audioMode === "capture") setCaptureFeedback(msg);
        else setResult(msg);
        return;
      }

      if (job.state === "stored") {
        if (job.result?.note) {
          setCaptureFeedback("");
          await loadNotes();
          setSelectedNote(job.result.note);
        } else if (job.result?.answer) {
          setResult(job.result.answer);
          setSources(job.result.sources ?? []);
        }
        return;
      }

      await wait(900);
    }
  }

  async function runTextQuery() {
    if (!question.trim()) {
      setTextPromptError("Type a question first.");
      return;
    }
    setIsWorking(true);
    setActivity("Reasoning");
    setSources([]);
    setResult("");
    setTextPromptError("");
    try {
      const answer = await postJson<AskResult>("/api/ask", { question: question.trim() });
      setResult(answer.answer);
      setSources(answer.sources);
      setActivity("Done");
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Request failed");
      setActivity("Failed");
    } finally {
      setIsWorking(false);
    }
  }

  async function deleteNote(note: Note) {
    await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    setSelectedNote(null);
    setDetailOpen(false);
    await loadNotes();
  }

  const micDisabled = isWorking && !isRecording;
  const navHidden = shell === "memory" && detailOpen;

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <div className="app-canvas">
        <div className="app-canvas__bloom" />
        <div className="app-canvas__mesh" />
        <div className="app-canvas__noise" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="popLayout">
          {shell === "memory" && !detailOpen && (
            <motion.div
              key="mem"
              initial={{ opacity: 0, filter: "blur(8px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(6px)" }}
              transition={{ duration: 0.35 }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <MemoryLane
                health={health}
                stats={stats}
                search={search}
                setSearch={setSearch}
                category={category}
                setCategory={setCategory}
                notes={notes}
                onOpen={openNote}
                onRefresh={() => void loadNotes()}
                onJumpAssistant={() => setShell("capture")}
              />
            </motion.div>
          )}

          {shell === "memory" && detailOpen && selectedNote && (
            <motion.div
              key="detail"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 38 }}
              className="absolute inset-0 z-30 flex flex-col bg-background shadow-[inset_1px_0_0_hsl(var(--border))]"
            >
              <MemoryInspect note={selectedNote} onBack={closeDetail} onDelete={deleteNote} />
            </motion.div>
          )}

          {(shell === "capture" || shell === "ask") && (
            <motion.div
              key="asst"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.32 }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <AssistantDeck
                mode={assistantMode}
                captureFeedback={captureFeedback}
                health={health}
                isRecording={isRecording}
                isWorking={isWorking}
                micDisabled={micDisabled}
                onMic={toggleMic}
                activity={activity}
                question={question}
                setQuestion={setQuestion}
                textPromptError={textPromptError}
                onRunText={() => void runTextQuery()}
                result={result}
                sources={sources}
                liveTranscript={liveTranscript}
                speechPreviewState={speechPreviewState}
                silenceAutoStop={silenceAutoStop}
                onSilenceAutoStopChange={setSilenceAutoStop}
                onPickSource={(note) => {
                  setSelectedNote(note);
                  setShell("memory");
                  setDetailOpen(true);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!navHidden && <FloatingDock shell={shell} onChange={setShell} />}
    </div>
  );
}
