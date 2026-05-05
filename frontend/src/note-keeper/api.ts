import type { Job } from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail ?? "Request failed");
  }
  return data;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  return parseResponse<T>(response);
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function postEmpty(url: string): Promise<void> {
  await parseResponse(await fetch(url, { method: "POST" }));
}

export async function postForm<T>(url: string, body: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", body });
  return parseResponse<T>(response);
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Like `wait`, but rejects with AbortError when `signal` aborts (and clears the timer). */
export function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const t = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Origin-relative WebSocket URL (works with Vite proxy in dev). */
export function websocketUrl(apiPathWithLeadingSlash: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${apiPathWithLeadingSlash}`;
}

export type WatchJobWebSocketOptions = {
  signal?: AbortSignal;
};

/**
 * Stream job updates via WebSocket. Detaches handlers and closes the socket on completion,
 * error, or `signal` abort so the server receives a clean disconnect and drops the subscriber.
 */
export function watchJobViaWebSocket(
  jobId: string,
  onUpdate: (job: Job) => void,
  options?: WatchJobWebSocketOptions
): Promise<void> {
  const { signal } = options ?? {};

  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket | null = null;

    const detachAndClose = () => {
      const sock = ws;
      ws = null;
      if (!sock) return;
      sock.onopen = null;
      sock.onmessage = null;
      sock.onerror = null;
      sock.onclose = null;
      if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) {
        try {
          sock.close(1000, "client done");
        } catch {
          /* noop */
        }
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      detachAndClose();
      reject(err);
    };

    const ok = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      detachAndClose();
      resolve();
    };

    const onAbort = () => {
      fail(new DOMException("Aborted", "AbortError"));
    };

    if (signal?.aborted) {
      queueMicrotask(() => fail(new DOMException("Aborted", "AbortError")));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    const path = `/api/jobs/${encodeURIComponent(jobId)}/watch`;
    ws = new WebSocket(websocketUrl(path));

    ws.onmessage = (ev) => {
      let job: Job;
      try {
        job = JSON.parse(ev.data) as Job;
      } catch {
        return;
      }
      onUpdate(job);
      if (job.terminal) {
        ok();
      }
    };

    ws.onerror = () => {
      fail(new Error("WebSocket connection error"));
    };

    ws.onclose = () => {
      if (settled) return;
      fail(new Error("WebSocket closed before job finished"));
    };
  });
}
