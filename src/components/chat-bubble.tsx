import type { Message } from "@/lib/types";
import { useTypewriter } from "@/hooks/use-typewriter";

interface ChatBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export function ChatBubble({ message, isStreaming = false }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const displayText = useTypewriter(message.content, !isUser && isStreaming);

  if (isUser) {
    return (
      <div data-role="user" className="animate-in slide-in-from-bottom-4 fade-in duration-300 ease-out flex w-full justify-end">
        <div className="max-w-[80%] rounded-xl rounded-br-md bg-primary px-4 py-2.5 text-base leading-relaxed text-primary-foreground">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-role="assistant" className="w-full text-base leading-relaxed text-foreground">
      <p className="whitespace-pre-wrap">{displayText}</p>
    </div>
  );
}
