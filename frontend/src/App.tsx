import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  Mic,
  MicOff,
  RefreshCcw,
  Search,
  Shield,
  Sparkles,
  Tags,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";

type Shell = "memory" | "capture" | "ask";
type Mode = "capture" | "ask";
type JobState = "queued" | "transcribing" | "analyzing" | "embedding" | "stored" | "answering" | "failed";

type Note = {
  id: string;
  title: string;
  transcript: string;
  summary: string;
  category: string;
  key_points: string[];
  action_items: string[];
  entities: string[];
  sensitivity: "normal" | "private" | "sensitive";
  created_at: string;
};

type AskResult = {
  question: string;
  answer: string;
  sources: Note[];
};

type Job = {
  id: string;
  kind: string;
  state: JobState;
  message: string;
  result?: { note?: Note } & Partial<AskResult>;
  error?: string;
};

const categories = [
  "Personal",
  "Work",
  "Project",
  "Task",
  "Credential or ID",
  "Meeting",
  "Journal",
  "Idea",
  "Finance",
  "Other"
];

export default function App() {
  const [shell, setShell] = useState<Shell>("capture");
  const [health, setHealth] = useState("…");
  const [isRecording, setIsRecording] = useState(false);
  const [activity, setActivity] = useState("Idle");
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSection, setDetailSection] = useState<"summary" | "extracts" | "transcript">("summary");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<string>("");
  const [sources, setSources] = useState<Note[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [textPromptError, setTextPromptError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const stats = useMemo(() => {
    const sensitive = notes.filter((n) => n.sensitivity !== "normal").length;
    const tasks = notes.reduce((t, n) => t + n.action_items.length, 0);
    return { total: notes.length, sensitive, tasks };
  }, [notes]);

  const assistantMode: Mode = shell === "ask" ? "ask" : "capture";

  useEffect(() => {
    checkHealth();
    loadNotes();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(loadNotes, 260);
    return () => window.clearTimeout(t);
  }, [category, search]);

  useEffect(() => {
    setTextPromptError("");
  }, [question, shell]);

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
    setDetailSection("summary");
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      });

      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        await uploadRecording();
      });

      recorder.start();
      setIsRecording(true);
      setActivity("Listening");
      setResult("");
      setSources([]);
    } catch (e) {
      setActivity(e instanceof Error ? e.message : "Mic blocked");
    }
  }

  function stopRecording() {
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
    setIsWorking(true);
    try {
      const audio = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const form = new FormData();
      form.append("file", audio, `${assistantMode}-${Date.now()}.webm`);
      const path = assistantMode === "capture" ? "/api/notes/audio" : "/api/ask/audio";
      const job = await postForm<{ job_id: string }>(path, form);
      await watchJob(job.job_id);
    } catch (e) {
      setActivity("Failed");
      setResult(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setIsWorking(false);
    }
  }

  async function watchJob(jobId: string) {
    for (;;) {
      const job = await fetchJson<Job>(`/api/jobs/${jobId}`);
      setActivity(job.message);

      if (job.state === "failed") {
        setResult(job.error ?? "Failed");
        return;
      }

      if (job.state === "stored") {
        if (job.result?.note) {
          setResult(`${job.result.note.title}\n\n${job.result.note.summary}`);
          await loadNotes();
          setSelectedNote(job.result.note);
        } else if (job.result?.answer) {
          setResult(job.result.answer);
          setSources(job.result.sources ?? []);
        }
        return;
      }

      await wait(1200);
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

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden pb-[calc(7rem+env(safe-area-inset-bottom))]">
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
              <MemoryInspect
                note={selectedNote}
                section={detailSection}
                onSection={setDetailSection}
                onBack={closeDetail}
                onDelete={deleteNote}
              />
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

function FloatingDock({ shell, onChange }: { shell: Shell; onChange: (s: Shell) => void }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 px-safe pb-safe pt-2">
      <div className="mx-auto grid w-full max-w-lg grid-cols-3 gap-1.5 rounded-[1.35rem] border border-white/[0.08] bg-card/90 p-2 shadow-[0_-8px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        <DockSlot
          active={shell === "memory"}
          onClick={() => onChange("memory")}
          layoutId="tab-notes"
          icon={<FileText className="h-[1.125rem] w-[1.125rem] sm:h-5 sm:w-5" />}
          label="Notes"
        />
        <DockSlot
          active={shell === "capture"}
          onClick={() => onChange("capture")}
          layoutId="tab-capture"
          icon={<Mic className="h-[1.125rem] w-[1.125rem] sm:h-5 sm:w-5" />}
          label="Capture"
        />
        <DockSlot
          active={shell === "ask"}
          onClick={() => onChange("ask")}
          layoutId="tab-ask"
          icon={<Search className="h-[1.125rem] w-[1.125rem] sm:h-5 sm:w-5" />}
          label="Ask"
        />
      </div>
    </nav>
  );
}

function DockSlot({
  active,
  onClick,
  icon,
  label,
  layoutId
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  layoutId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex min-h-[3rem] w-full touch-manipulation flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[0.58rem] font-semibold uppercase tracking-[0.12em] transition sm:min-h-[3.25rem] sm:gap-1 sm:text-[0.65rem] sm:tracking-[0.14em] ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          className="absolute inset-0 rounded-xl bg-primary/14 ring-1 ring-primary/40"
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        />
      )}
      <span className={`relative z-10 ${active ? "text-primary" : "text-muted-foreground"}`}>{icon}</span>
      <span className="relative z-10">{label}</span>
    </button>
  );
}

function MemoryLane({
  health,
  stats,
  search,
  setSearch,
  category,
  setCategory,
  notes,
  onOpen,
  onRefresh,
  onJumpAssistant
}: {
  health: string;
  stats: { total: number; sensitive: number; tasks: number };
  search: string;
  setSearch: (s: string) => void;
  category: string;
  setCategory: (c: string) => void;
  notes: Note[];
  onOpen: (n: Note) => void;
  onRefresh: () => void;
  onJumpAssistant: () => void;
}) {
  const offline = health === "Unreachable";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-white/[0.06] bg-background/70 px-safe pt-safe backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-2">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight">Notes</h1>
            <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
              {stats.total} on device · {stats.sensitive} private
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/35 text-foreground transition hover:bg-muted active:scale-[0.96]"
            aria-label="Refresh notes"
          >
            <RefreshCcw className="h-[1.05rem] w-[1.05rem]" />
          </button>
        </div>

        <div className="space-y-2.5 px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles and summaries…"
              className="h-11 rounded-xl border-border/70 bg-muted/30 pl-10 text-[0.9375rem] placeholder:text-muted-foreground/55"
            />
          </div>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-11 w-full rounded-xl border-border/70 bg-muted/30 font-mono text-xs"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex gap-2 overflow-x-auto px-4 pb-3 no-scrollbar">
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[0.65rem] ${
              offline ? "border-destructive/35 bg-destructive/10 text-destructive-foreground" : "border-border/55 bg-muted/40 text-muted-foreground"
            }`}
          >
            <Shield className="h-3 w-3 shrink-0" />
            <span className="max-w-[14rem] truncate" title={health}>
              {offline ? "Offline" : health}
            </span>
          </span>
          {stats.tasks > 0 && (
            <span className="inline-flex shrink-0 items-center rounded-full border border-border/55 bg-muted/40 px-3 py-1.5 font-mono text-[0.65rem] text-muted-foreground">
              {stats.tasks} actions
            </span>
          )}
        </div>
      </header>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-4">
        {notes.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-primary/28 bg-gradient-to-b from-muted/30 to-transparent px-6 py-12 text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25">
              <FileText className="h-7 w-7 text-primary" />
            </div>
            <p className="mt-5 font-display text-lg font-semibold">No notes yet</p>
            <p className="mx-auto mt-2 max-w-[18rem] text-[0.875rem] leading-relaxed text-muted-foreground">
              Capture voice memos on the Capture tab. They stay on this device.
            </p>
            <Button type="button" onClick={onJumpAssistant} className="mt-7 rounded-xl px-8 font-semibold shadow-glow-sm">
              Go to Capture
            </Button>
          </motion.div>
        ) : (
          notes.map((note, i) => (
            <motion.button
              key={note.id}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.035, 0.4) }}
              onClick={() => onOpen(note)}
              className="group flex w-full gap-3 rounded-2xl border border-white/[0.07] bg-card/55 p-4 text-left shadow-sm outline-none ring-primary/30 transition hover:border-primary/30 hover:bg-card/75 focus-visible:ring-2 active:scale-[0.99]"
            >
              <div className="w-1 shrink-0 self-stretch rounded-full bg-gradient-to-b from-primary to-teal-500 opacity-85 min-h-[3rem]" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-[1.02rem] font-semibold leading-snug tracking-tight">{note.title}</h2>
                  <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground opacity-60 transition group-hover:opacity-100" />
                </div>
                <p className="mt-2 line-clamp-2 text-[0.875rem] leading-relaxed text-muted-foreground">{note.summary}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-muted/70 px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide text-muted-foreground">
                    {note.category}
                  </span>
                  <time className="font-mono text-[0.62rem] text-muted-foreground/90">{formatShortDate(note.created_at)}</time>
                  {note.sensitivity !== "normal" && (
                    <span className="rounded-lg bg-warning/15 px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide text-warning">
                      {note.sensitivity}
                    </span>
                  )}
                </div>
              </div>
            </motion.button>
          ))
        )}
      </div>
    </div>
  );
}

function MemoryInspect({
  note,
  section,
  onSection,
  onBack,
  onDelete
}: {
  note: Note;
  section: "summary" | "extracts" | "transcript";
  onSection: (s: "summary" | "extracts" | "transcript") => void;
  onBack: () => void;
  onDelete: (n: Note) => void;
}) {
  const tabs: { id: typeof section; label: string }[] = [
    { id: "summary", label: "Brief" },
    { id: "extracts", label: "Extracts" },
    { id: "transcript", label: "Raw" }
  ];

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-safe pt-safe backdrop-blur-xl">
        <button
          type="button"
          onClick={onBack}
          className="flex h-12 w-12 items-center justify-center rounded-2xl text-foreground transition hover:bg-muted active:scale-[0.96]"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 py-3">
          <p className="truncate font-mono text-[0.6rem] uppercase tracking-[0.22em] text-muted-foreground">{note.category}</p>
          <h1 className="truncate font-display text-lg font-bold">{note.title}</h1>
        </div>
        <button
          type="button"
          onClick={() => onDelete(note)}
          className="mr-2 flex h-11 w-11 items-center justify-center rounded-2xl text-destructive transition hover:bg-destructive/12 active:scale-[0.96]"
          aria-label="Delete memory"
        >
          <Trash2 className="h-[1.15rem] w-[1.15rem]" />
        </button>
      </header>

      <div className="flex gap-2 overflow-x-auto px-4 pb-3 pt-4 font-mono text-[0.65rem] uppercase tracking-[0.18em] no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSection(t.id)}
            className={`relative shrink-0 rounded-xl px-4 py-2 transition ${
              section === t.id ? "bg-primary text-primary-foreground shadow-glow-sm" : "bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
            className="space-y-6 pt-2"
          >
            {section === "summary" && (
              <div className="rounded-[1.35rem] border border-white/[0.06] bg-card/55 p-5 backdrop-blur-md">
                <p className="text-[0.95rem] leading-relaxed text-foreground/95">{note.summary}</p>
                <div className="mt-6 flex flex-wrap gap-2 border-t border-border/60 pt-5 font-mono text-[0.65rem]">
                  <Badge className="rounded-lg border-border/60 bg-muted/50 px-2 py-1 font-mono text-[0.6rem] font-normal uppercase tracking-wide">
                    <Tags className="mr-1 h-3 w-3" />
                    {note.category}
                  </Badge>
                  {note.sensitivity !== "normal" && (
                    <Badge className="rounded-lg border-warning/35 bg-warning/12 px-2 py-1 font-mono text-[0.6rem] font-normal uppercase tracking-wide text-warning">
                      {note.sensitivity}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {section === "extracts" && (
              <div className="grid gap-4">
                <ExtractCard title="Key points" items={note.key_points} />
                <ExtractCard title="Action paths" items={note.action_items} />
              </div>
            )}

            {section === "transcript" && (
              <div className="rounded-[1.35rem] border border-white/[0.06] bg-muted/20 p-5 font-mono text-[0.78rem] leading-relaxed text-muted-foreground">
                {note.transcript}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}

function ExtractCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[1.35rem] border border-white/[0.06] bg-card/45 p-5 backdrop-blur-sm">
      <h3 className="font-display text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing extracted.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item} className="flex gap-3 text-[0.9rem] leading-relaxed">
              <CheckCircle2 className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssistantDeck({
  mode,
  health,
  isRecording,
  isWorking,
  micDisabled,
  onMic,
  activity,
  question,
  setQuestion,
  textPromptError,
  onRunText,
  result,
  sources,
  onPickSource
}: {
  mode: Mode;
  health: string;
  isRecording: boolean;
  isWorking: boolean;
  micDisabled: boolean;
  onMic: () => void;
  activity: string;
  question: string;
  setQuestion: (s: string) => void;
  textPromptError: string;
  onRunText: () => void;
  result: string;
  sources: Note[];
  onPickSource: (n: Note) => void;
}) {
  const recall = mode === "ask";
  const offline = health === "Unreachable";

  return (
    <div className="flex min-h-0 flex-1 flex-col px-safe pt-safe">
      <div className="flex shrink-0 justify-center pb-3 pt-1">
        <p
          className={`max-w-[min(100%,20rem)] truncate rounded-full border px-3 py-1.5 text-center font-mono text-[0.58rem] leading-tight sm:text-[0.6rem] ${
            offline ? "border-destructive/35 bg-destructive/10 text-destructive-foreground" : "border-border/60 bg-muted/30 text-muted-foreground"
          }`}
          title={health}
        >
          {offline ? "Offline" : health}
        </p>
      </div>

      {/* Hero: mic centered in remaining flex space */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 sm:gap-2">
        <OrbMic active={isRecording} busy={isWorking && !isRecording} disabled={micDisabled} onPress={onMic} />
        <VoiceVisualizer active={isRecording} />
        <p className="max-w-[min(100%,20rem)] truncate px-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground" title={activity}>
          {(isWorking || isRecording) && (
            <Loader2
              className={`mr-1 inline h-3 w-3 align-middle text-primary ${isRecording ? "animate-pulse" : "animate-spin"}`}
              aria-hidden
            />
          )}
          {activity}
        </p>
      </div>

      {/* Ask: single fused composer bar · Capture: hint */}
      <div className="shrink-0 space-y-2 px-1 pb-3">
        {recall ? (
          <>
            <div className="relative rounded-[1.75rem] border border-white/[0.09] bg-gradient-to-b from-card/90 to-muted/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="flex items-end gap-2 p-2 pl-4">
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Message your notes…"
                  rows={2}
                  className="max-h-[9rem] min-h-[3.25rem] flex-1 resize-none border-0 bg-transparent px-0 py-2.5 text-[0.9375rem] leading-relaxed shadow-none outline-none ring-0 placeholder:text-muted-foreground/40 focus-visible:ring-0"
                />
                <Button
                  type="button"
                  size="icon"
                  disabled={isWorking || !question.trim()}
                  onClick={onRunText}
                  className="mb-0.5 h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-primary to-teal-600 text-primary-foreground shadow-[0_4px_20px_hsl(var(--primary)/0.35)] ring-2 ring-primary/20 transition hover:from-primary hover:to-teal-500 disabled:pointer-events-none disabled:opacity-35"
                  aria-label="Send question"
                >
                  <ArrowUp className="h-5 w-5" strokeWidth={2.25} />
                </Button>
              </div>
            </div>
            {textPromptError ? (
              <p className="px-3 text-[0.75rem] leading-snug text-destructive">{textPromptError}</p>
            ) : (
              <p className="px-3 text-[0.6875rem] text-muted-foreground/90">Voice or type · Answers only use notes saved on this device.</p>
            )}
          </>
        ) : (
          <p className="text-center text-[0.75rem] leading-snug text-muted-foreground">
            Voice saves new notes · Tap <span className="text-foreground/90">Ask</span> below to type questions against saved notes.
          </p>
        )}
      </div>

      {result ? (
        <div className="no-scrollbar mb-2 max-h-[min(28vh,11rem)] min-h-0 shrink-0 overflow-y-auto rounded-xl border border-white/[0.06] bg-card/55 p-3 backdrop-blur-md sm:max-h-[min(30vh,12rem)]">
          <AnimatePresence mode="wait">
            <motion.div
              key={result.slice(0, 48)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-primary">
                <Sparkles className="h-3 w-3" />
                Result
              </div>
              <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed text-foreground/95">{result}</p>
              {sources.length > 0 && (
                <div className="space-y-1.5 border-t border-border/60 pt-3">
                  <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-muted-foreground">Sources</p>
                  {sources.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => onPickSource(note)}
                      className="flex w-full items-center justify-between rounded-lg border border-border/55 bg-muted/20 px-2.5 py-2 text-left text-[0.8125rem] transition active:scale-[0.99]"
                    >
                      <span className="line-clamp-1 font-medium">{note.title}</span>
                      <Tags className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
}

function OrbMic({
  active,
  busy,
  disabled,
  onPress
}: {
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <div className="relative flex h-[min(40vw,9rem)] w-[min(40vw,9rem)] items-center justify-center sm:h-[10rem] sm:w-[10rem]">
      <motion.div
        className="absolute rounded-full border border-dashed border-primary/35"
        animate={{ rotate: busy ? 360 : active ? 360 : 0 }}
        transition={{ duration: busy ? 10 : active ? 22 : 0, repeat: Infinity, ease: "linear" }}
        style={{ width: "132%", height: "132%" }}
      />
      <motion.div
        className="absolute rounded-full bg-gradient-to-tr from-primary/25 via-accent/15 to-transparent blur-xl"
        animate={{ scale: active ? [1, 1.1, 1] : 1, opacity: active ? [0.55, 0.85, 0.55] : 0.32 }}
        transition={{ duration: 2.4, repeat: active ? Infinity : 0 }}
        style={{ width: "118%", height: "118%" }}
      />

      <AnimatePresence>
        {active && (
          <motion.span
            className="absolute rounded-full bg-primary/28"
            initial={{ scale: 0.88, opacity: 0.75 }}
            animate={{ scale: 1.45, opacity: 0 }}
            transition={{ duration: 1.25, repeat: Infinity }}
            style={{ width: "72%", height: "72%" }}
          />
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        disabled={disabled}
        onClick={onPress}
        whileTap={disabled ? undefined : { scale: 0.93 }}
        className={`relative z-10 flex h-[min(28vw,6rem)] w-[min(28vw,6rem)] touch-manipulation items-center justify-center rounded-full border border-white/10 shadow-[0_14px_40px_rgba(0,0,0,0.5)] sm:h-[6.75rem] sm:w-[6.75rem] ${
          active ? "bg-gradient-to-br from-destructive to-rose-700 text-white ring-[3px] ring-destructive/35" : "bg-gradient-to-br from-primary via-teal-400 to-cyan-600 text-primary-foreground ring-[3px] ring-primary/28"
        } ${disabled ? "opacity-45" : ""}`}
        aria-label={active ? "Stop recording" : "Start recording"}
      >
        {busy ? (
          <Loader2 className="h-[2rem] w-[2rem] animate-spin sm:h-[2.25rem] sm:w-[2.25rem]" />
        ) : active ? (
          <MicOff className="h-[2rem] w-[2rem] sm:h-[2.25rem] sm:w-[2.25rem]" />
        ) : (
          <Mic className="h-[2rem] w-[2rem] sm:h-[2.25rem] sm:w-[2.25rem]" />
        )}
      </motion.button>
    </div>
  );
}

function VoiceVisualizer({ active }: { active: boolean }) {
  return (
    <div className="flex h-8 items-end justify-center gap-[2px] px-4 sm:h-10">
      {Array.from({ length: 14 }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[2px] rounded-full bg-gradient-to-t from-primary to-accent sm:w-[3px]"
          animate={
            active
              ? {
                  height: [4, 14 + ((i * 9) % 22), 8],
                  opacity: [0.35, 1, 0.5]
                }
              : { height: 4, opacity: 0.14 }
          }
          transition={{
            duration: 0.38 + (i % 6) * 0.04,
            repeat: active ? Infinity : 0,
            repeatType: "reverse",
            ease: "easeInOut"
          }}
        />
      ))}
    </div>
  );
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return parseResponse<T>(response);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

async function postForm<T>(url: string, body: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", body });
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail ?? "Request failed");
  }
  return data;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
