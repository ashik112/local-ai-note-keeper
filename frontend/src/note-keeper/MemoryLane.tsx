import { motion } from "framer-motion";
import { ChevronDown, FileText, RefreshCcw, Search, Shield } from "lucide-react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { cn } from "../lib/utils";
import type { Note } from "./types";
import { categories } from "./constants";
import { getCategoryColor } from "./categoryColor";
import { formatShortDate } from "./format";

type MemoryLaneProps = {
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
};

export function MemoryLane({
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
}: MemoryLaneProps) {
  const offline = health === "Unreachable";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/40">
      <header className="shrink-0 px-safe pt-safe">
        <div className="flex items-center gap-2 px-2 pb-2 pt-1">
          <button
            type="button"
            onClick={onRefresh}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted/80 hover:text-foreground active:scale-[0.94]"
            aria-label={`Refresh notes (${stats.total} on device${stats.tasks ? `, ${stats.tasks} action items in notes` : ""})`}
            title={
              stats.tasks > 0
                ? `${stats.total} notes · ${stats.sensitive} private · ${stats.tasks} action item${stats.tasks === 1 ? "" : "s"} extracted`
                : `${stats.total} notes · ${stats.sensitive} private`
            }
          >
            <RefreshCcw className="h-[1rem] w-[1rem]" />
          </button>

          <div className="relative min-h-10 min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-muted-foreground/80" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes"
              className="h-10 min-h-10 rounded-full border-white/[0.07] bg-muted/45 py-0 pl-10 pr-3 font-sans text-[0.8125rem] leading-normal placeholder:text-muted-foreground/45 shadow-none backdrop-blur-sm"
              aria-label="Search notes"
            />
          </div>

          <div className="relative min-h-10 max-w-[42%] min-w-[7.25rem] shrink-0 [&:focus-within]:ring-2 [&:focus-within]:ring-ring [&:focus-within]:ring-offset-2 [&:focus-within]:ring-offset-background rounded-full">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
              className={cn(
                "h-10 min-h-10 w-full cursor-pointer rounded-full appearance-none border border-white/[0.07]",
                "bg-muted/45 py-0 pl-3 pr-10 font-sans text-[0.8125rem] leading-normal text-foreground shadow-none",
                "outline-none transition-[box-shadow,color] focus-visible:ring-0"
              )}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 z-[1] h-4 w-4 shrink-0 -translate-y-1/2 text-muted-foreground"
              aria-hidden
              strokeWidth={2}
            />
          </div>
        </div>

        {offline && (
          <div className="flex items-center gap-1.5 px-2 pb-2 font-mono text-[0.58rem] leading-snug text-destructive">
            <Shield className="h-3 w-3 shrink-0" />
            <span className="min-w-0">Offline · list may be stale</span>
          </div>
        )}
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-28 pt-1">
        {notes.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto flex max-w-[17rem] flex-col items-center rounded-xl border border-dashed border-white/[0.08] bg-muted/20 px-5 py-10 text-center"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/22">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-4 text-[0.9rem] font-semibold leading-snug text-foreground">Nothing here yet</p>
            <p className="mt-1.5 text-[0.72rem] leading-relaxed text-muted-foreground">
              Voice caps on Capture — stays on device.
            </p>
            <Button type="button" onClick={onJumpAssistant} className="mt-5 h-9 rounded-full px-6 text-[0.8rem] font-semibold shadow-glow-sm">
              Record
            </Button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-2 gap-2 pb-1 md:grid-cols-3 md:gap-3">
            {notes.map((note, i) => (
              <motion.button
                key={note.id}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.028, 0.35) }}
                onClick={() => onOpen(note)}
                className="group mb-2 w-full break-inside-avoid rounded-xl border border-white/[0.06] bg-card/90 p-2.5 text-left outline-none ring-primary/25 transition hover:border-white/[0.1] hover:bg-card active:scale-[0.985] focus-visible:ring-2 sm:mb-2.5"
                style={{
                  boxShadow: `inset 3px 0 0 0 ${getCategoryColor(note.category)}`
                }}
              >
                <h2 className="line-clamp-3 pl-0.5 text-[0.8125rem] font-semibold leading-[1.25] tracking-tight text-foreground">{note.title}</h2>
                <p className="mt-1 line-clamp-5 pl-0.5 text-[0.7rem] leading-snug text-muted-foreground/92">{note.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-0.5 font-mono text-[0.55rem] uppercase tracking-wide text-muted-foreground/85">
                  <span className="max-w-[9rem] truncate text-[0.58rem] normal-case tracking-normal text-foreground/75">{note.category}</span>
                  <span className="opacity-40" aria-hidden>
                    ·
                  </span>
                  <time>{formatShortDate(note.created_at)}</time>
                  {note.sensitivity !== "normal" && (
                    <>
                      <span className="opacity-40" aria-hidden>
                        ·
                      </span>
                      <span className="text-warning">{note.sensitivity}</span>
                    </>
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
