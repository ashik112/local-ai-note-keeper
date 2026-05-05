import { motion } from "framer-motion";
import { FileText, Mic, Search } from "lucide-react";
import type { ReactNode } from "react";

import type { Shell } from "./types";

export function FloatingDock({
  shell,
  onChange,
  unreadCount = 0
}: {
  shell: Shell;
  onChange: (s: Shell) => void;
  unreadCount?: number;
}) {
  return (
    <nav className="relative z-40 shrink-0 px-safe pb-safe pt-2">
      <div className="grid w-full grid-cols-3 gap-1 rounded-[1.5rem] border border-white/[0.07] bg-slate-950/55 p-1.5 shadow-[0_-12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-2xl">
        <DockSlot
          active={shell === "memory"}
          onClick={() => onChange("memory")}
          layoutId="tab-notes"
          accent="sky"
          badgeCount={unreadCount > 0 ? unreadCount : undefined}
          icon={<FileText className="h-[1.125rem] w-[1.125rem] sm:h-5 sm:w-5" />}
          label="Notes"
        />
        <DockSlot
          active={shell === "capture"}
          onClick={() => onChange("capture")}
          layoutId="tab-capture"
          accent="cyan"
          icon={<Mic className="h-[1.125rem] w-[1.125rem] sm:h-5 sm:w-5" />}
          label="Capture"
        />
        <DockSlot
          active={shell === "ask"}
          onClick={() => onChange("ask")}
          layoutId="tab-ask"
          accent="violet"
          icon={<Search className="h-[1.125rem] w-[1.125rem] sm:h-5 sm:w-5" />}
          label="Ask"
        />
      </div>
    </nav>
  );
}

const dockAccent = {
  sky: {
    grad: "from-sky-500/40 via-slate-950 to-indigo-950/90",
    ring: "ring-sky-400/45",
    glow: "shadow-[0_0_36px_rgba(56,189,248,0.22),inset_0_1px_0_rgba(255,255,255,0.12)]",
    icon: "text-sky-100",
    iconGlow: "drop-shadow-[0_0_14px_rgba(56,189,248,0.65)]"
  },
  cyan: {
    grad: "from-teal-400/45 via-slate-950 to-emerald-950/85",
    ring: "ring-teal-400/50",
    glow: "shadow-[0_0_38px_rgba(45,212,191,0.28),inset_0_1px_0_rgba(255,255,255,0.12)]",
    icon: "text-teal-100",
    iconGlow: "drop-shadow-[0_0_14px_rgba(45,212,191,0.7)]"
  },
  violet: {
    grad: "from-violet-500/38 via-slate-950 to-fuchsia-950/80",
    ring: "ring-violet-400/48",
    glow: "shadow-[0_0_34px_rgba(167,139,250,0.26),inset_0_1px_0_rgba(255,255,255,0.1)]",
    icon: "text-violet-100",
    iconGlow: "drop-shadow-[0_0_14px_rgba(167,139,250,0.55)]"
  }
} as const;

function DockSlot({
  active,
  onClick,
  icon,
  label,
  layoutId,
  accent,
  badgeCount
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  layoutId: string;
  accent: keyof typeof dockAccent;
  badgeCount?: number;
}) {
  const p = dockAccent[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative isolate flex min-h-[3rem] w-full touch-manipulation flex-col items-center justify-center gap-1 rounded-[13px] py-2 transition-[opacity,transform] duration-200 active:scale-[0.96] sm:min-h-[3.35rem] ${
        active ? "text-white" : "text-muted-foreground/75 hover:text-muted-foreground"
      }`}
    >
      {badgeCount != null && badgeCount > 0 && (
        <span
          className="pointer-events-none absolute right-1.5 top-0.5 z-[4] flex min-w-[1rem] items-center justify-center rounded-full bg-destructive px-[5px] py-0.5 font-mono text-[0.5rem] font-bold leading-none text-white shadow-sm"
          aria-label={`${badgeCount} unread`}
        >
          {badgeCount > 9 ? "9+" : badgeCount}
        </span>
      )}
      {active && (
        <>
          <motion.span
            layoutId={layoutId}
            className={`pointer-events-none absolute inset-0 z-0 rounded-[inherit] bg-gradient-to-br ${p.grad} ring-1 ${p.ring} ${p.glow}`}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          />
          <span
            className="pointer-events-none absolute inset-[3px] z-[1] rounded-[10px] bg-gradient-to-t from-transparent via-white/[0.03] to-white/[0.09] opacity-90"
            aria-hidden
          />
        </>
      )}
      <span className={`relative z-[2] flex items-center justify-center ${active ? `${p.icon} ${p.iconGlow}` : ""}`}>{icon}</span>
      <span
        className={`relative z-[2] font-display text-[0.52rem] font-semibold uppercase tracking-[0.24em] sm:text-[0.58rem] ${active ? "text-white/[0.96]" : ""}`}
      >
        {label}
      </span>
    </button>
  );
}
