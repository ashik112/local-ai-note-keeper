export const categories = [
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
] as const;

/** localStorage key — default on (previous behavior). */
export const STORAGE_SILENCE_AUTO_STOP = "pnk:silenceAutoStop";

export function readSilenceAutoStopPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const s = window.localStorage.getItem(STORAGE_SILENCE_AUTO_STOP);
    if (s === null) return true;
    return s === "1";
  } catch {
    return true;
  }
}

/** Wall-clock silence after speech before auto-stop (same as manual stop). */
export const SILENCE_AUTO_STOP_MS = 5000;
/** Normalized RMS — below this counts as silence once speech was detected */
export const SILENCE_RMS_THRESHOLD = 0.018;

export const CATEGORY_COLORS: Record<string, string> = {
  Personal: "#f59e0b",
  Work: "#3b82f6",
  Meeting: "#8b5cf6",
  Project: "#10b981",
  Task: "#f97316",
  Idea: "#ec4899",
  Journal: "#06b6d4",
  Finance: "#84cc16",
  "Credential or ID": "#ef4444",
  Other: "#6b7280"
};
