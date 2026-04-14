"use client";

import { ChatMessages } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { TextSelectionPopup } from "@/components/text-selection-popup";
import { AiErrorBanner } from "@/components/ai-error-banner";
import { useConversation } from "@/contexts/conversation-context";

export function ConversationView() {
  const {
    input,
    contentType,
    messages,
    notes,
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
      {error && <AiErrorBanner error={error} />}
      <ChatInput
        value={input}
        onChange={setInput}
        contentType={contentType}
        onContentTypeChange={messages.length === 0 ? changeContentType : undefined}
        onSend={sendMessage}
        disabled={isLoading}
        isFetchingTweet={isFetchingTweet}
        highlightsCount={notes.length}
        className="px-8"
      />
      <TextSelectionPopup />
    </div>
  );
}
