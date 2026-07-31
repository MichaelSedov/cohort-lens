// SSE client for /functions/v1/ask. We use `fetch` + a manual ReadableStream
// reader rather than EventSource because EventSource doesn't support POST and
// can't set the Authorization header — both are required here.

import { supabase } from "./supabase";

export type ChatEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ms: number; error: boolean; preview?: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export async function ask(opts: {
  orgId: string;
  question: string;
  onEvent: (evt: ChatEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) throw new Error("not signed in");

  const res = await fetch("/functions/v1/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "X-Org-Id": opts.orgId,
    },
    body: JSON.stringify({ question: opts.question }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`ask http ${res.status}: ${text.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // Split SSE frames — each event ends with \n\n.
    for (;;) {
      const sep = buf.indexOf("\n\n");
      if (sep < 0) break;
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      // Each frame may have multiple `data:` lines (spec) — we only ever emit one.
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        opts.onEvent(JSON.parse(json) as ChatEvent);
      } catch { /* ignore malformed frame */ }
    }
  }
}
