import { ArrowLeft, CheckCircle2, Tags, Trash2 } from "lucide-react";

import { Badge } from "../components/ui/badge";
import type { Note } from "./types";
import { getCategoryColor } from "./categoryColor";

type MemoryInspectProps = {
  note: Note;
  onBack: () => void;
  onDelete: (n: Note) => void;
};

export function MemoryInspect({ note, onBack, onDelete }: MemoryInspectProps) {
  const hasExtracts = note.key_points.length > 0 || note.action_items.length > 0;

  return (
    <>
      <header
        className="flex shrink-0 items-center gap-1.5 px-safe pb-1.5 pt-safe"
        style={{ boxShadow: `inset 3px 0 0 0 ${getCategoryColor(note.category)}` }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted/80 hover:text-foreground active:scale-[0.94]"
          aria-label="Back"
        >
          <ArrowLeft className="h-[1.05rem] w-[1.05rem]" />
        </button>
        <div className="min-w-0 flex-1 py-0.5 pl-0.5">
          <h1 className="truncate text-[0.9rem] font-semibold leading-tight tracking-tight text-foreground">{note.title}</h1>
          <p className="truncate font-mono text-[0.58rem] uppercase tracking-[0.14em] text-muted-foreground/90">{note.category}</p>
        </div>
        <button
          type="button"
          onClick={() => onDelete(note)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-destructive/90 transition hover:bg-destructive/12 active:scale-[0.94]"
          aria-label="Delete note"
        >
          <Trash2 className="h-[0.95rem] w-[0.95rem]" />
        </button>
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-4 pt-2">
        <div className="space-y-5">
          <section aria-labelledby="note-brief-heading">
            <h2 id="note-brief-heading" className="mb-2 px-1 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
              Brief
            </h2>
            <div className="rounded-xl border border-white/[0.06] bg-card/55 p-4 backdrop-blur-md">
              <p className="text-[0.92rem] leading-relaxed text-foreground/95">{note.summary}</p>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-4 font-mono text-[0.65rem]">
                <Badge
                  className="rounded-lg border-transparent px-2 py-1 font-mono text-[0.6rem] font-normal uppercase tracking-wide text-white"
                  style={{ backgroundColor: getCategoryColor(note.category) }}
                >
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
          </section>

          {hasExtracts ? (
            <section aria-labelledby="note-extracts-heading">
              <h2 id="note-extracts-heading" className="mb-2 px-1 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
                Extracts
              </h2>
              <div className="grid gap-3">
                {note.key_points.length > 0 ? <ExtractCard title="Key points" items={note.key_points} /> : null}
                {note.action_items.length > 0 ? <ExtractCard title="Actions" items={note.action_items} /> : null}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="note-raw-heading">
            <h2 id="note-raw-heading" className="mb-2 px-1 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
              Raw transcript
            </h2>
            <div className="rounded-xl border border-white/[0.06] bg-muted/20 p-4 font-mono text-[0.78rem] leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {note.transcript.trim().length > 0 ? note.transcript : "—"}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ExtractCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/45 p-4 backdrop-blur-sm">
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
