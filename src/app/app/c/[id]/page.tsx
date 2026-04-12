export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { ConversationView } from "./conversation-view";
import { ComposerSidebarContainer } from "@/components/composer-sidebar-container";
import { ConversationProvider } from "@/contexts/conversation-context";
import { getConversation } from "@/app/actions/conversations";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ConversationPage({ params }: Props) {
  const { id } = await params;

  const data = await getConversation(id);
  if (!data) {
    redirect("/");
  }

  return (
    <ConversationProvider
      key={id}
      conversationId={id}
      initialData={{
        messages: data.messages,
        notes: data.notes,
        contentType: data.contentType,
        composerContent: data.composerContent,
        composerPlatform: data.composerPlatform,
        title: data.title,
        originalPostUrl: data.originalPostUrl ?? undefined,
        pendingInput: data.pendingInput ?? undefined,
      }}
    >
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 overflow-hidden md:rounded-[12px] md:bg-sidebar">
          <ConversationView />
        </div>
        <ComposerSidebarContainer />
      </div>
    </ConversationProvider>
  );
}
