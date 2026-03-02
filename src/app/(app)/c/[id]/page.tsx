import { redirect } from "next/navigation";
import { ConversationView } from "./conversation-view";
import { NotesSidebarContainer } from "@/components/notes-sidebar-container";
import { ConversationProvider } from "@/contexts/conversation-context";
import { getConversation } from "@/app/actions/conversations";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ConversationPage({ params }: Props) {
  const { id } = await params;

  let data = await getConversation(id);
  if (!data) {
    redirect("/");
  }

  return (
    <ConversationProvider
      conversationId={id}
      initialData={{
        messages: data.messages,
        notes: data.notes,
        contentType: data.contentType,
        title: data.title,
      }}
    >
      <div className="flex flex-1 overflow-hidden">
        <ConversationView />
        <NotesSidebarContainer />
      </div>
    </ConversationProvider>
  );
}
