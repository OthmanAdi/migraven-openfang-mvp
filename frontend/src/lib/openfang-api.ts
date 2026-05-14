export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCallView[];
};

export type ToolCallView = {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  error?: string;
};

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "tool_result"; id: string; result?: string; error?: string }
  | { type: "done" }
  | { type: "error"; message: string };

type RawDelta = {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
};

type ToolBuf = { id?: string; name?: string; args: string };

export async function* streamChat(
  messages: ChatMessage[],
  options: { agent?: string; model?: string; signal?: AbortSignal } = {}
): AsyncGenerator<StreamEvent> {
  const body = {
    model: options.model ?? "ad-auditor",
    messages: messages.map(({ role, content }) => ({ role, content })),
    stream: true,
  };
  const resp = await fetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!resp.ok || !resp.body) {
    yield { type: "error", message: `HTTP ${resp.status}: ${await resp.text()}` };
    return;
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  const toolBufs = new Map<number, ToolBuf>();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          for (const [, tb] of toolBufs) {
            if (tb.id && tb.name) {
              yield { type: "tool_call", id: tb.id, name: tb.name, arguments: tb.args };
            }
          }
          yield { type: "done" };
          return;
        }
        try {
          const raw = JSON.parse(payload) as RawDelta;
          const choice = raw.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) yield { type: "token", content: delta.content };
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const tb = toolBufs.get(idx) ?? { args: "" };
              if (tc.id) tb.id = tc.id;
              if (tc.function?.name) tb.name = tc.function.name;
              if (tc.function?.arguments) tb.args += tc.function.arguments;
              toolBufs.set(idx, tb);
            }
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
  }
  yield { type: "done" };
}

export function emptyChat(): ChatMessage[] {
  return [];
}
