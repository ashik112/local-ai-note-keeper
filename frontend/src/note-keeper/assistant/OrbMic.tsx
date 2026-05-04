import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Mic, MicOff } from "lucide-react";

type OrbMicProps = {
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  compact?: boolean;
};

export function OrbMic({ active, busy, disabled, onPress, compact = false }: OrbMicProps) {
  return (
    <div
      className={`relative flex items-center justify-center ${
        compact
          ? "h-[min(32vw,6.75rem)] w-[min(32vw,6.75rem)] sm:h-[7.35rem] sm:w-[7.35rem]"
          : "h-[min(40vw,9rem)] w-[min(40vw,9rem)] sm:h-[10rem] sm:w-[10rem]"
      }`}
    >
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
        className={`relative z-10 flex touch-manipulation items-center justify-center rounded-full border border-white/10 shadow-[0_14px_40px_rgba(0,0,0,0.5)] ${
          compact
            ? "h-[min(22vw,4.95rem)] w-[min(22vw,4.95rem)] sm:h-[5.55rem] sm:w-[5.55rem]"
            : "h-[min(28vw,6rem)] w-[min(28vw,6rem)] sm:h-[6.75rem] sm:w-[6.75rem]"
        } ${
          active ? "bg-gradient-to-br from-destructive to-rose-700 text-white ring-[3px] ring-destructive/35" : "bg-gradient-to-br from-primary via-teal-400 to-cyan-600 text-primary-foreground ring-[3px] ring-primary/28"
        } ${disabled ? "opacity-45" : ""}`}
        aria-label={active ? "Stop recording" : "Start recording"}
      >
        {busy ? (
          <Loader2 className={`animate-spin ${compact ? "h-7 w-7 sm:h-8 sm:w-8" : "h-[2rem] w-[2rem] sm:h-[2.25rem] sm:w-[2.25rem]"}`} />
        ) : active ? (
          <MicOff className={compact ? "h-7 w-7 sm:h-8 sm:w-8" : "h-[2rem] w-[2rem] sm:h-[2.25rem] sm:w-[2.25rem]"} />
        ) : (
          <Mic className={compact ? "h-7 w-7 sm:h-8 sm:w-8" : "h-[2rem] w-[2rem] sm:h-[2.25rem] sm:w-[2.25rem]"} />
        )}
      </motion.button>
    </div>
  );
}
