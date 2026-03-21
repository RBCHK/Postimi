"use client";

import { ChatMessages } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { TextSelectionPopup } from "@/components/text-selection-popup";
import { useConversation } from "@/contexts/conversation-context";

export function ConversationView() {
  const {
    input,
    contentType,
    messages,
    isLoading,
    isFetchingTweet,
    error,
    setInput,
    sendMessage,
    changeContentType,
  } = useConversation();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChatMessages />
      {error && (
        <div className="mx-auto w-full max-w-2xl px-4 pb-2">
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400">
            {error.message || "Ошибка при обращении к модели"}
          </p>
        </div>
      )}
      <ChatInput
        value={input}
        onChange={setInput}
        contentType={contentType}
        onContentTypeChange={messages.length === 0 ? changeContentType : undefined}
        onSend={sendMessage}
        disabled={isLoading}
        isFetchingTweet={isFetchingTweet}
        className="px-8"
      />
      <TextSelectionPopup />
    </div>
  );
}
