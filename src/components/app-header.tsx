"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { FilePlus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createConversation } from "@/app/actions/conversations";

export function AppHeader() {
  const router = useRouter();

  async function handleNewDraft() {
    const id = await createConversation({ title: "Untitled" });
    router.push(`/c/${id}`);
    window.dispatchEvent(new Event("drafts-updated"));
  }

  return (
    <header className="flex flex-col shrink-0 pt-[env(safe-area-inset-top)]">
      <div className="flex h-[64px] items-center justify-between px-4">
        <Link
          href="/"
          onClick={() => window.dispatchEvent(new Event("focus-chat-input"))}
          className="text-lg font-semibold tracking-tight text-foreground hover:text-foreground/90 transition-colors"
        >
          X Growth Copilot
        </Link>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex gap-1.5 text-muted-foreground"
            onClick={handleNewDraft}
          >
            <FilePlus className="h-4 w-4" />
            New Draft
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-8 w-8 text-muted-foreground"
            onClick={() => router.push("/settings")}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <UserButton />
        </div>
      </div>
    </header>
  );
}
