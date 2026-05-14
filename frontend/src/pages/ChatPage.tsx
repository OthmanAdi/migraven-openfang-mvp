import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyChat,
  streamChat,
  type ChatMessage,
  type ToolCallView,
} from "../lib/openfang-api.js";
import { ChatMessageView } from "../components/ChatMessageView.js";

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(emptyChat);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<"gpt-5.5" | "claude-opus-4-5">("gpt-5.5");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const next: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "", toolCalls: [] },
    ];
    setMessages(next);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const toolCalls = new Map<string, ToolCallView>();

    try {
      for await (const evt of streamChat(next.slice(0, -1), {
        agent: "ad-auditor",
        model,
        signal: ctrl.signal,
      })) {
        if (evt.type === "token") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant") return prev;
            const updated = { ...last, content: last.content + evt.content };
            return [...prev.slice(0, -1), updated];
          });
        } else if (evt.type === "tool_call") {
          toolCalls.set(evt.id, {
            id: evt.id,
            name: evt.name,
            arguments: evt.arguments,
          });
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant") return prev;
            return [...prev.slice(0, -1), { ...last, toolCalls: Array.from(toolCalls.values()) }];
          });
        } else if (evt.type === "tool_result") {
          const existing = toolCalls.get(evt.id);
          if (existing) {
            toolCalls.set(evt.id, { ...existing, result: evt.result, error: evt.error });
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== "assistant") return prev;
              return [
                ...prev.slice(0, -1),
                { ...last, toolCalls: Array.from(toolCalls.values()) },
              ];
            });
          }
        } else if (evt.type === "error") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant") return prev;
            return [...prev.slice(0, -1), { ...last, content: `[error] ${evt.message}` }];
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [...prev.slice(0, -1), { ...last, content: `[network] ${message}` }];
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, input, messages, model]);

  const stop = () => abortRef.current?.abort();

  return (
    <>
      <header className="topbar">
        <h1>migRaven AD Auditor</h1>
        <span className="meta">agent: ad-auditor</span>
        <span className="meta">framework: OpenFang</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as "gpt-5.5" | "claude-opus-4-5")}
          style={{
            marginLeft: "auto",
            background: "var(--bg-input)",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "0.25rem 0.5rem",
          }}
        >
          <option value="gpt-5.5">gpt-5.5 (Foundry)</option>
          <option value="claude-opus-4-5">claude-opus-4-5 (Foundry)</option>
        </select>
      </header>

      <main ref={scrollRef} className="chat">
        {messages.length === 0 ? (
          <div style={{ color: "var(--fg-mute)", marginTop: "4rem", textAlign: "center" }}>
            Stelle eine Audit-Frage, z.B.<br />
            <em>„Welche Konten haben unconstrained delegation?"</em>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <ChatMessageView key={i} msg={m} />
        ))}
      </main>

      <div className="composer">
        <div className="composer-inner">
          <textarea
            placeholder="Frage…  (Enter zum Senden, Shift+Enter fuer neue Zeile)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
          />
          {busy ? (
            <button onClick={stop}>Stop</button>
          ) : (
            <button onClick={() => void send()} disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </>
  );
}
