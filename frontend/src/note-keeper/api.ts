async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail ?? "Request failed");
  }
  return data;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
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

export async function postForm<T>(url: string, body: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", body });
  return parseResponse<T>(response);
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
