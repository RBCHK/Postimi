import { useState, useMemo } from "react";
import type { Message } from "@/lib/types";
import { useTypewriter } from "@/hooks/use-typewriter";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { Root, Text, Element, RootContent } from "hast";
import { Button } from "@/components/ui/button";
import { useConversation } from "@/contexts/conversation-context";

const COLLAPSE_THRESHOLD = 300;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rehype plugin that wraps matching text nodes in <mark> elements.
 * Operates on the HTML AST (after markdown→HTML), so it matches
 * the rendered text, not the raw markdown source.
 */
function rehypeHighlight(highlights: string[]) {
  return () => (tree: Root) => {
    if (highlights.length === 0) return;
    const pattern = highlights.map(escapeRegExp).join("|");
    const regex = new RegExp(`(${pattern})`);

    function walk(node: Root | Element) {
      const newChildren: RootContent[] = [];
      for (const child of node.children) {
        if (child.type === "text") {
          const text = (child as Text).value;
          const parts = text.split(regex);
          if (parts.length === 1) {
            newChildren.push(child);
          } else {
            for (const part of parts) {
              if (!part) continue;
              if (regex.test(part)) {
                newChildren.push({
                  type: "element",
                  tagName: "mark",
                  properties: {},
                  children: [{ type: "text", value: part }],
                } as Element);
              } else {
                newChildren.push({ type: "text", value: part } as Text);
              }
            }
          }
        } else if (child.type === "element") {
          walk(child as Element);
          newChildren.push(child);
        } else {
          newChildren.push(child);
        }
      }
      node.children = newChildren;
    }

    walk(tree);
  };
}

interface ChatBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

const markdownComponents: Components = {
  hr: () => null,
  em: ({ children }) => <em className="not-italic text-amber-400/80">{children}</em>,
  h1: ({ children }) => <h1 className="text-lg font-semibold mt-8 mb-4">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold mt-8 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-6 mb-2">{children}</h3>,
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
  mark: ({ children }) => (
    <mark className="bg-amber-400/25 text-inherit rounded-sm px-0.5">{children}</mark>
  ),
};

export function ChatBubble({ message, isStreaming = false }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const displayText = useTypewriter(message.content, !isUser && isStreaming);
  const { notes } = useConversation();

  const isLong = isUser && message.content.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  const highlights = useMemo(
    () => notes.filter((n) => n.messageId === message.id).map((n) => n.content),
    [notes, message.id]
  );

  const rehypePlugins = useMemo(
    () => (highlights.length > 0 ? [rehypeHighlight(highlights)] : []),
    [highlights]
  );

  if (isUser) {
    const displayContent =
      isLong && !expanded
        ? message.content.slice(0, COLLAPSE_THRESHOLD).trimEnd() + "…"
        : message.content;

    return (
      <div
        data-role="user"
        data-message-id={message.id}
        className="animate-in slide-in-from-bottom-4 fade-in duration-300 ease-out flex w-full justify-end"
      >
        <div className="max-w-[80%] rounded-xl rounded-br-md bg-primary px-4 py-2.5 text-base leading-relaxed text-primary-foreground">
          <p className="whitespace-pre-wrap wrap-break-word">{displayContent}</p>
          {isLong && (
            <Button
              variant="link"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 h-auto p-0 text-xs text-primary-foreground/60 [@media(hover:hover)]:hover:text-primary-foreground/90 [@media(hover:hover)]:hover:no-underline"
            >
              {expanded ? "Show less" : "Show more"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-role="assistant"
      data-message-id={message.id}
      className="w-full text-base leading-relaxed text-foreground"
    >
      <ReactMarkdown components={markdownComponents} rehypePlugins={rehypePlugins}>
        {displayText}
      </ReactMarkdown>
    </div>
  );
}
