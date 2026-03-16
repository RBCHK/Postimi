"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, type TextUIPart, type DynamicToolUIPart } from "ai";
import type {
  ConfigChange,
  CsvSummary,
  ResearchNoteItem,
  StrategyAnalysisItem,
  XProfile,
} from "@/lib/types";
import { parseCsv } from "@/lib/csv-parser";
import { saveAnalysis } from "@/app/actions/strategist";
import { savePlanProposal } from "@/app/actions/plan-proposal";
import { useXProfile } from "@/hooks/use-x-profile";
import { getStoredAgentModel } from "@/lib/model";

export type LeftTab = "analyses" | "research";

interface StrategistContextValue {
  analyses: StrategyAnalysisItem[];
  selectedId: string | null;
  csvSummary: CsvSummary | null;
  csvError: string | null;
  /** True while the AI is streaming or the request is in-flight */
  isAnalyzing: boolean;
  /** True from the moment the user clicks Run until finish/error — survives status gaps */
  analysisInProgress: boolean;
  analysisError: string | null;
  searchQueries: string[];
  streamedText: string;
  profile: XProfile;
  updateProfile: (updates: Partial<XProfile>) => void;
  // Research tab
  researchNotes: ResearchNoteItem[];
  selectedResearchId: string | null;
  leftTab: LeftTab;
  setLeftTab: (tab: LeftTab) => void;
  selectResearchNote: (id: string | null) => void;

  selectAnalysis: (id: string | null) => void;
  handleCsvInput: (raw: string) => void;
  runAnalysis: () => void;
  deleteAnalysisItem: (id: string) => void;
}

const StrategistContext = createContext<StrategistContextValue | null>(null);

export function useStrategist() {
  const ctx = useContext(StrategistContext);
  if (!ctx) {
    throw new Error("useStrategist must be used within StrategistProvider");
  }
  return ctx;
}

interface StrategistProviderProps {
  children: ReactNode;
  initialAnalyses: StrategyAnalysisItem[];
  initialResearchNotes: ResearchNoteItem[];
}

export function StrategistProvider({
  children,
  initialAnalyses,
  initialResearchNotes,
}: StrategistProviderProps) {
  const [analyses, setAnalyses] = useState<StrategyAnalysisItem[]>(initialAnalyses);
  const [selectedId, setSelectedId] = useState<string | null>(initialAnalyses[0]?.id ?? null);
  const [csvSummary, setCsvSummary] = useState<CsvSummary | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [savedSearchQueries, setSavedSearchQueries] = useState<string[]>([]);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("analyses");
  const [selectedResearchId, setSelectedResearchId] = useState<string | null>(
    initialResearchNotes[0]?.id ?? null
  );

  const { profile, updateProfile } = useXProfile();

  // Proper refs that survive re-renders — transport's body() reads from these
  const csvSummaryRef = useRef<CsvSummary | null>(null);
  csvSummaryRef.current = csvSummary;

  const profileRef = useRef<XProfile>(profile);
  profileRef.current = profile;

  const weekStartRef = useRef(new Date().toISOString().split("T")[0]);

  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/strategist",
        body: () => ({
          csvSummary: csvSummaryRef.current,
          weekStart: weekStartRef.current,
          profile: profileRef.current,
          model: getStoredAgentModel("strategist"),
        }),
      })
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    onError: (error: Error) => {
      setAnalysisError(error.message || "Analysis failed");
      setAnalysisInProgress(false);
    },
    onFinish: async ({ message }: { message: UIMessage }) => {
      if (!csvSummaryRef.current) {
        setAnalysisInProgress(false);
        return;
      }

      const text = message.parts
        .filter((p): p is TextUIPart => p.type === "text")
        .map((p) => p.text)
        .join("");

      if (!text) {
        setAnalysisError("Model returned empty response");
        setAnalysisInProgress(false);
        return;
      }

      const queries = message.parts
        .filter((p): p is DynamicToolUIPart => p.type === "dynamic-tool")
        .map((p) => (p.input as { query?: string }).query ?? "")
        .filter(Boolean);

      setSavedSearchQueries(queries);

      try {
        const saved = await saveAnalysis({
          csvSummary: csvSummaryRef.current,
          searchQueries: queries,
          recommendation: text,
          weekStart: new Date(weekStartRef.current),
        });

        setAnalyses((prev) => [saved, ...prev]);
        setSelectedId(saved.id);

        // Parse config-proposal block and save as PlanProposal
        const proposalMatch = text.match(/```json:config-proposal\s*([\s\S]*?)```/);
        if (proposalMatch?.[1]) {
          try {
            const changes: ConfigChange[] = JSON.parse(proposalMatch[1].trim());
            if (Array.isArray(changes) && changes.length > 0) {
              const summaryMatch = text.match(/##[^#\n]*Стратегия[^#\n]*\n([\s\S]{0,300})/i);
              const proposalSummary =
                summaryMatch?.[1]?.trim().slice(0, 300) ??
                `Изменения в шаблон расписания (${changes.length} шт.) от ${weekStartRef.current}`;
              await savePlanProposal({
                changes,
                summary: proposalSummary,
                analysisId: saved.id,
                proposalType: "config",
              });
              window.dispatchEvent(new Event("slots-updated"));
            }
          } catch (parseErr) {
            console.warn("[strategist] Failed to parse config-proposal JSON:", parseErr);
          }
        }
      } catch (e) {
        setAnalysisError(e instanceof Error ? e.message : "Failed to save analysis");
      } finally {
        setAnalysisInProgress(false);
      }
    },
  });

  const isAnalyzing = status === "streaming" || status === "submitted";

  // Collect live search queries from streaming messages
  const lastMessage = messages[messages.length - 1];

  const liveSearchQueries: string[] =
    lastMessage?.parts
      .filter((p): p is DynamicToolUIPart => p.type === "dynamic-tool")
      .map((p) => (p.input as { query?: string }).query ?? "")
      .filter(Boolean) ?? [];

  const streamedText: string =
    lastMessage?.parts
      .filter((p): p is TextUIPart => p.type === "text")
      .map((p) => p.text)
      .join("") ?? "";

  const handleCsvInput = useCallback((raw: string) => {
    if (!raw.trim()) {
      setCsvSummary(null);
      setCsvError(null);
      return;
    }
    try {
      const summary = parseCsv(raw);
      setCsvSummary(summary);
      setCsvError(null);
    } catch (e) {
      setCsvSummary(null);
      setCsvError(e instanceof Error ? e.message : "Failed to parse CSV");
    }
  }, []);

  const runAnalysis = useCallback(() => {
    if (!csvSummaryRef.current || isAnalyzing) return;
    weekStartRef.current = new Date().toISOString().split("T")[0];
    setSavedSearchQueries([]);
    setAnalysisError(null);
    setAnalysisInProgress(true);
    setSelectedId(null);
    sendMessage({ text: "" });
  }, [isAnalyzing, sendMessage]);

  const selectAnalysis = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const deleteAnalysisItem = useCallback((id: string) => {
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  const selectResearchNote = useCallback((id: string | null) => {
    setSelectedResearchId(id);
  }, []);

  const displayedSearchQueries = isAnalyzing ? liveSearchQueries : savedSearchQueries;

  return (
    <StrategistContext.Provider
      value={{
        analyses,
        selectedId,
        csvSummary,
        csvError,
        isAnalyzing,
        analysisInProgress,
        analysisError,
        searchQueries: displayedSearchQueries,
        streamedText,
        profile,
        updateProfile,
        researchNotes: initialResearchNotes,
        selectedResearchId,
        leftTab,
        setLeftTab,
        selectResearchNote,
        selectAnalysis,
        handleCsvInput,
        runAnalysis,
        deleteAnalysisItem,
      }}
    >
      {children}
    </StrategistContext.Provider>
  );
}
