import type { ChatMessage } from "../lib/openfang-api.js";
import { ToolStep } from "./ToolStep.js";

export function ChatMessageView({ msg }: { msg: ChatMessage }) {
  return (
    <div className={`msg ${msg.role}`}>
      <div className="role">{msg.role}</div>
      {msg.content ? <div>{msg.content}</div> : null}
      {msg.toolCalls?.map((tc) => <ToolStep key={tc.id} call={tc} />)}
    </div>
  );
}
