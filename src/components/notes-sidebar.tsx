"use client";

import { X, ChevronLeft, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConversation } from "@/contexts/conversation-context";
import type { Note } from "@/lib/types";

interface NotesSidebarProps {
  onClose?: () => void;
}

export function NotesSidebar({ onClose }: NotesSidebarProps) {
  const { notes, removeNote, addNote, updateNote } = useConversation();
  const [modalOpen, setModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  function closeModal() {
    setNoteText("");
    setEditingNote(null);
    setModalOpen(false);
  }

  function openEditModal(note: Note) {
    setEditingNote(note);
    setNoteText(note.content);
    setModalOpen(true);
  }

  function handleSaveNote() {
    const text = noteText.trim();
    if (!text) return closeModal();
    if (editingNote) {
      updateNote(editingNote.id, text);
    } else {
      addNote(text);
    }
    closeModal();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex w-[102px] items-center justify-between gap-2 px-2 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
          )}
          <h2 className="truncate text-sm font-medium tracking-[-0.02em] text-muted-foreground">
            Notes
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-lg hover:bg-transparent!"
          onClick={() => setModalOpen(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="flex-1" />
      ) : (
        <ScrollArea className="flex-1 min-h-0 p-0">
          <div className="flex flex-col gap-3 w-[102px]">
            {notes.map((note) => (
              <div
                key={note.id}
                className="group relative cursor-pointer rounded-xl bg-white/3 px-2.5 pb-2 pt-2 transition-colors duration-150 overflow-hidden hover:bg-white/6"
                style={{ height: "102px", width: "102px" }}
                onClick={() => openEditModal(note)}
              >
                <p className="h-full text-xs leading-relaxed line-clamp-5">{note.content}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-6 w-6 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeNote(note.id);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeModal}
        >
          <div
            className="flex h-[500px] w-[750px] flex-col gap-4 rounded-2xl bg-sidebar p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="shrink-0 text-sm font-medium">
              {editingNote ? "Edit Note" : "New Note"}
            </h3>
            <textarea
              className="min-h-0 flex-1 resize-none rounded-xl border border-border bg-white/5 px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-white/20"
              placeholder="Type your note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              autoFocus
            />
            <div className="flex shrink-0 justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeModal}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveNote} disabled={!noteText.trim()}>
                {editingNote ? "Save" : "Add Note"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
