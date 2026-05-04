import { motion } from "framer-motion";

import type { SpeechPreviewState } from "../types";

type LiveTranscriptProps = {
  transcript: string;
  speechPreviewState: SpeechPreviewState;
  eyebrowMessage?: string;
};

export function LiveTranscript({ transcript, speechPreviewState, eyebrowMessage = "Live preview" }: LiveTranscriptProps) {
  const fallback =
    speechPreviewState === "unsupported"
      ? "Live preview needs a Chromium-based browser (or Safari). Your note will use on-device speech-to-text from the recording instead."
      : "Speak — browser captions appear here (preview only).";

  const latest = transcript.trim() ? transcript : fallback;

  const badge =
    speechPreviewState === "listening"
      ? { className: "bg-emerald-500/15 text-emerald-400", label: "listening" }
      : speechPreviewState === "error"
        ? { className: "bg-destructive/15 text-destructive", label: "mic/text error" }
        : speechPreviewState === "unsupported"
          ? { className: "bg-muted/50 text-muted-foreground", label: "off" }
          : { className: "bg-muted/50 text-muted-foreground", label: "idle" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-1 mb-2 shrink-0 rounded-xl border border-primary/20 bg-primary/8 p-3 backdrop-blur-md"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-primary">{eyebrowMessage}</span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.14em] ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <motion.p
        key={transcript.slice(-48)}
        initial={{ color: "hsl(var(--foreground))" }}
        animate={{ color: "hsl(var(--primary))" }}
        transition={{ duration: 1 }}
        className="max-h-36 overflow-y-auto whitespace-pre-wrap text-[0.82rem] leading-relaxed opacity-80"
      >
        {latest}
      </motion.p>
    </motion.div>
  );
}
