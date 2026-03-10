"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, type TextUIPart, type DynamicToolUIPart } from "ai";
import type { CsvSummary, StrategyAnalysisItem } from "@/lib/types";
import { parseCsv } from "@/lib/csv-parser";
import { saveAnalysis } from "@/app/actions/strategist";

interface StrategistContextValue {
  analyses: StrategyAnalysisItem[];
  selectedId: string | null;
  csvSummary: CsvSummary | null;
  csvError: string | null;
  isAnalyzing: boolean;
  searchQueries: string[];
  streamedText: string;

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
}

export function StrategistProvider({
  children,
  initialAnalyses,
}: StrategistProviderProps) {
  const [analyses, setAnalyses] = useState<StrategyAnalysisItem[]>(initialAnalyses);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialAnalyses[0]?.id ?? null
  );
  const [csvSummary, setCsvSummary] = useState<CsvSummary | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [savedSearchQueries, setSavedSearchQueries] = useState<string[]>([]);

  const csvSummaryRef = { current: csvSummary };
  csvSummaryRef.current = csvSummary;

  const weekStart = new Date().toISOString().split("T")[0];

  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/strategist",
        body: () => ({
          csvSummary: csvSummaryRef.current,
          weekStart,
        }),
      })
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    onFinish: async ({ message }: { message: UIMessage }) => {
      if (!csvSummaryRef.current) return;

      const text = message.parts
        .filter((p): p is TextUIPart => p.type === "text")
        .map((p) => p.text)
        .join("");

      if (!text) return;

      const queries = message.parts
        .filter((p): p is DynamicToolUIPart => p.type === "dynamic-tool")
        .map((p) => (p.input as { query?: string }).query ?? "")
        .filter(Boolean);

      setSavedSearchQueries(queries);

      const saved = await saveAnalysis({
        csvSummary: csvSummaryRef.current,
        searchQueries: queries,
        recommendation: text,
        weekStart: new Date(weekStart),
      });

      setAnalyses((prev) => [saved, ...prev]);
      setSelectedId(saved.id);
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
    setSavedSearchQueries([]);
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

  const displayedSearchQueries = isAnalyzing ? liveSearchQueries : savedSearchQueries;

  return (
    <StrategistContext.Provider
      value={{
        analyses,
        selectedId,
        csvSummary,
        csvError,
        isAnalyzing,
        searchQueries: displayedSearchQueries,
        streamedText,
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
