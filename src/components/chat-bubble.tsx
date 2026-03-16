import { useState } from "react";
import type { Message } from "@/lib/types";
import { useTypewriter } from "@/hooks/use-typewriter";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

const COLLAPSE_THRESHOLD = 300;

interface ChatBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

const markdownComponents: Components = {
  hr: () => null,
  em: ({ children }) => <em className="not-italic text-amber-400/80">{children}</em>,
  h1: ({ children }) => <h1 className="text-lg font-bold mt-8 mb-3">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold mt-7 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-bold mt-7 mb-2">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-7 mt-2 mb-4 space-y-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-7 mt-2 mb-4 space-y-2">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-muted-foreground/40 pl-4 text-muted-foreground my-4 italic">
      {children}
    </blockquote>
  ),
  p: ({ children }) => <p className="mt-2 mb-2 last:mb-0">{children}</p>,
  pre: ({ children }) => (
    <pre className="bg-muted whitespace-pre-wrap break-all rounded-md px-4 py-3 text-sm font-mono my-3">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="bg-muted px-1 py-0.5 rounded text-sm font-mono">{children}</code>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="underline wrap-break-word" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function ChatBubble({ message, isStreaming = false }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const displayText = useTypewriter(message.content, !isUser && isStreaming);

  const isLong = isUser && message.content.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  if (isUser) {
    const displayContent =
      isLong && !expanded
        ? message.content.slice(0, COLLAPSE_THRESHOLD).trimEnd() + "…"
        : message.content;

    return (
      <div
        data-role="user"
        className="animate-in slide-in-from-bottom-4 fade-in duration-300 ease-out flex w-full justify-end"
      >
        <div className="max-w-[80%] rounded-xl rounded-br-md bg-primary px-4 py-2.5 text-base leading-relaxed text-primary-foreground">
          <p className="whitespace-pre-wrap wrap-break-word">{displayContent}</p>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs text-primary-foreground/60 [@media(hover:hover)]:hover:text-primary-foreground/90 transition-colors"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-role="assistant" className="w-full text-base leading-relaxed text-foreground">
      <ReactMarkdown components={markdownComponents}>{displayText}</ReactMarkdown>
    </div>
  );
}
