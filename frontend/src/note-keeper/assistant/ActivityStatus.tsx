import { Loader2 } from "lucide-react";

/** Shows monospace activity label + spinner whenever mic is busy or uploading/processing */
export function ActivityStatus({ busy, activity }: { busy: boolean; activity: string }) {
  return (
    <p
      className="max-w-[min(100%,20rem)] truncate px-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground"
      title={activity}
    >
      {busy && (
        <Loader2
          className="mr-1 inline-block h-3 w-3 shrink-0 align-middle text-primary animate-spin motion-reduce:animate-none motion-reduce:opacity-100"
          aria-hidden
        />
      )}
      {activity}
    </p>
  );
}
