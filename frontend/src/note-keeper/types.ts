export type Shell = "memory" | "capture" | "ask";
export type Mode = "capture" | "ask";
export type JobState =
  | "queued"
  | "transcribing"
  | "analyzing"
  | "embedding"
  | "stored"
  | "answering"
  | "failed";

/** Browser SpeechRecognition preview — optional path for uploads */
export type SpeechPreviewState = "unsupported" | "idle" | "listening" | "error";

export interface SpeechRecognitionAlternative {
  readonly transcript: string;
}

export interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  readonly [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  readonly [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEventMap {
  result: SpeechRecognitionEvent;
  error: SpeechRecognitionErrorEvent;
  end: Event;
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener<K extends keyof SpeechRecognitionEventMap>(
    type: K,
    listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => void
  ): void;
}

export interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

export type Note = {
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

export type AskResult = {
  question: string;
  answer: string;
  sources: Note[];
};

export type Job = {
  id: string;
  kind: string;
  state: JobState;
  message: string;
  result?: { note?: Note } & Partial<AskResult>;
  error?: string;
};
