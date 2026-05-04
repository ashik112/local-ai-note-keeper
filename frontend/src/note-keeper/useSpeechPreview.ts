import { useCallback, useRef, useState } from "react";

import type {
  SpeechRecognition,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionEvent,
  SpeechPreviewState
} from "./types";

export function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechPreview() {
  const [liveTranscript, setLiveTranscript] = useState("");
  const [speechPreviewState, setSpeechPreviewState] = useState<SpeechPreviewState>("idle");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const committedRef = useRef("");
  const draftRef = useRef("");
  const shouldListenRef = useRef(false);

  const resetTranscript = useCallback(() => {
    committedRef.current = "";
    draftRef.current = "";
    setLiveTranscript("");
    setSpeechPreviewState((s) => (s === "unsupported" ? "unsupported" : "idle"));
  }, []);

  const stopSpeechPreview = useCallback(() => {
    shouldListenRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
    }
    setSpeechPreviewState((state) => (state === "unsupported" ? "unsupported" : "idle"));
  }, []);

  const startSpeechPreview = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSpeechPreviewState("unsupported");
      return;
    }

    stopSpeechPreview();

    try {
      shouldListenRef.current = true;
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const piece = res[0]?.transcript ?? "";
          if (res.isFinal) {
            committedRef.current = `${committedRef.current}${committedRef.current ? " " : ""}${piece.trim()}`.trim();
          } else {
            interim += piece;
          }
        }
        const display =
          `${committedRef.current}${committedRef.current && interim.trim() ? " " : ""}${interim.trim()}`.trim();
        draftRef.current = display;
        setLiveTranscript(display);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        setSpeechPreviewState("error");
      };

      recognition.onend = () => {
        if (shouldListenRef.current && recognitionRef.current === recognition) {
          try {
            recognition.start();
          } catch {
            /* already running */
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setSpeechPreviewState("listening");
    } catch {
      setSpeechPreviewState("error");
      stopSpeechPreview();
    }
  }, [stopSpeechPreview]);

  const peekBrowserTranscript = useCallback(() => draftRef.current.trim(), []);

  return { liveTranscript, speechPreviewState, startSpeechPreview, stopSpeechPreview, resetTranscript, peekBrowserTranscript };
}
