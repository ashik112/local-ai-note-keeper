import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2, Sparkles, Tags, Timer } from "lucide-react";

import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";

import { ActivityStatus } from "./assistant/ActivityStatus";
import { LiveTranscript } from "./assistant/LiveTranscript";
import { OrbMic } from "./assistant/OrbMic";
import { VoiceVisualizer } from "./assistant/VoiceVisualizer";
import type { Mode, Note, SpeechPreviewState } from "./types";

export type AssistantDeckProps = {
  mode: Mode;
  /** Capture-tab errors only (short recording, pipeline failure). Ask tab uses `result`. */
  captureFeedback: string;
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
  liveTranscript: string;
  speechPreviewState: SpeechPreviewState;
  silenceAutoStop: boolean;
  onSilenceAutoStopChange: (next: boolean) => void;
  onPickSource: (n: Note) => void;
};

function SilenceAutoStopToggle({
  idPrefix,
  silenceAutoStop,
  onSilenceAutoStopChange
}: {
  idPrefix: string;
  silenceAutoStop: boolean;
  onSilenceAutoStopChange: (next: boolean) => void;
}) {
  const labelId = `${idPrefix}-silence-autostop-label`;
  return (
    <div className="flex shrink-0 justify-center px-3 pb-2">
      <div className="flex max-w-[min(100%,22rem)] items-center gap-2 rounded-full border border-white/[0.07] bg-muted/25 px-3 py-1.5">
        <Timer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span id={labelId} className="min-w-0 flex-1 text-[0.6875rem] leading-snug text-muted-foreground">
          Auto-stop after <span className="tabular-nums text-foreground/90">5s</span> silence
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={silenceAutoStop}
          aria-labelledby={labelId}
          onClick={() => onSilenceAutoStopChange(!silenceAutoStop)}
          className={`relative inline-flex h-[1.35rem] w-[2.5rem] shrink-0 items-center rounded-full transition-colors ${
            silenceAutoStop ? "bg-primary/90" : "bg-muted/80"
          }`}
        >
          <span
            className={`pointer-events-none absolute top-[3px] h-[1.05rem] w-[1.05rem] rounded-full bg-white shadow transition-transform duration-200 ease-out ${
              silenceAutoStop ? "translate-x-[1.28rem]" : "translate-x-[3px]"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function HealthPill({ health }: { health: string }) {
  const offline = health === "Unreachable";
  return (
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
  );
}

export function AssistantDeck(props: AssistantDeckProps) {
  const {
    mode,
    captureFeedback,
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
    liveTranscript,
    speechPreviewState,
    silenceAutoStop,
    onSilenceAutoStopChange,
    onPickSource
  } = props;

  const showVoicePreview = isRecording || liveTranscript.trim().length > 0;
  const heroBusy = isWorking || isRecording;

  const hero = (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 sm:gap-2">
        <OrbMic active={isRecording} busy={isWorking && !isRecording} disabled={micDisabled} onPress={onMic} />
        <VoiceVisualizer active={isRecording} />
        <ActivityStatus busy={heroBusy} activity={activity} />
      </div>
      <SilenceAutoStopToggle
        idPrefix={mode === "ask" ? "ask" : "capture"}
        silenceAutoStop={silenceAutoStop}
        onSilenceAutoStopChange={onSilenceAutoStopChange}
      />
      {showVoicePreview && (
        <LiveTranscript
          transcript={liveTranscript}
          speechPreviewState={speechPreviewState}
          eyebrowMessage={mode === "ask" ? "Listening (browser preview)" : "Live preview"}
        />
      )}
    </>
  );

  if (mode === "ask") {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-safe pb-24 pt-safe">
        <HealthPill health={health} />

        {hero}

        <div className="shrink-0 space-y-2 px-1 pb-3">
          <div className="rounded-[1.65rem] border border-white/[0.09] bg-gradient-to-b from-card/90 to-muted/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_28px_rgba(0,0,0,0.32)] backdrop-blur-xl">
            <div className="flex items-end gap-2 p-2 pl-4">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Message your notes..."
                rows={1}
                className="max-h-[6rem] min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-0 py-2 text-[0.9375rem] leading-relaxed shadow-none outline-none ring-0 placeholder:text-muted-foreground/45 focus-visible:ring-0"
              />
              <Button
                type="button"
                size="icon"
                disabled={isWorking || !question.trim()}
                onClick={onRunText}
                className="mb-0.5 h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-teal-600 text-primary-foreground shadow-[0_4px_20px_hsl(var(--primary)/0.35)] ring-2 ring-primary/20 transition hover:from-primary hover:to-teal-500 disabled:pointer-events-none disabled:opacity-35"
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
        </div>

        {(isWorking || result.trim().length > 0) && (
          <div className="no-scrollbar mx-1 mb-2 max-h-[min(42vh,17rem)] min-h-0 shrink-0 overflow-y-auto rounded-xl border border-white/[0.1] bg-card/85 p-3.5 shadow-lg backdrop-blur-md sm:max-h-[min(44vh,19rem)]">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${result.slice(0, 48)}-${isWorking}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-primary">
                  <Sparkles className="h-3 w-3" />
                  {isWorking && !result ? "Working..." : "Result"}
                </div>
                {isWorking && !result ? (
                  <div className="flex items-center gap-2 py-5 text-[0.875rem] leading-relaxed text-muted-foreground">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
                    Reading your notes and drafting an answer...
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed text-foreground/95">{result}</p>
                )}
                {!isWorking && sources.length > 0 && (
                  <div className="space-y-1.5 border-t border-border/60 pt-3">
                    <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-muted-foreground">Sources for this answer</p>
                    {sources.map((note) => (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => onPickSource(note)}
                        className="flex w-full items-center gap-2 rounded-lg border border-border/55 bg-muted/25 px-2.5 py-2 text-left text-[0.8125rem] transition active:scale-[0.99]"
                      >
                        <span className="line-clamp-2 min-w-0 flex-1 font-medium leading-snug">{note.title}</span>
                        <Tags className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-safe pb-24 pt-safe">
      <HealthPill health={health} />

      {hero}

      <div className="shrink-0 space-y-2 px-1 pb-3">
        {captureFeedback ? (
          <p className="px-3 text-center text-[0.75rem] leading-snug text-destructive">{captureFeedback}</p>
        ) : null}
        <p className="text-center text-[0.75rem] leading-snug text-muted-foreground">
          Voice saves new notes · Tap <span className="text-foreground/90">Ask</span> below to type questions against saved notes.
        </p>
      </div>
    </div>
  );
}
