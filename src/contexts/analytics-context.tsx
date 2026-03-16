"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { AnalyticsSummary, ContentCsvRow, GoalChartData, OverviewCsvRow } from "@/lib/types";
import { detectCsvType, parseContentCsvRows, parseOverviewCsvRows } from "@/lib/csv-parser";
import {
  importContentData,
  importDailyStats,
  getAnalyticsSummary,
  getAnalyticsDateRange,
} from "@/app/actions/analytics";

export type PeriodPreset = "7D" | "2W" | "1M" | "3M" | "1Y" | "ALL";

const PRESET_DAYS: Record<Exclude<PeriodPreset, "ALL">, number> = {
  "7D": 7,
  "2W": 14,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
};

interface ImportResult {
  contentRows?: number;
  overviewRows?: number;
  contentEnriched?: number;
  contentSkipped?: number;
  overviewImported?: number;
  overviewUpdated?: number;
}

interface AnalyticsContextValue {
  dateRange: { from: Date; to: Date } | null;
  fullDateRange: { from: Date; to: Date } | null;
  activePreset: PeriodPreset;
  summary: AnalyticsSummary | null;
  goalChartData: GoalChartData | null;
  isLoading: boolean;

  // Import
  contentCsv: ContentCsvRow[] | null;
  overviewCsv: OverviewCsvRow[] | null;
  importError: string | null;
  isImporting: boolean;
  lastImportResult: ImportResult | null;
  handleCsvFile: (raw: string) => void;
  clearCsvFile: (type: "content" | "overview") => void;
  runImport: () => Promise<boolean>;

  // Data
  setPreset: (preset: PeriodPreset) => void;
  setDateRange: (range: { from: Date; to: Date }) => void;
  refreshData: () => Promise<void>;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function useAnalytics() {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) throw new Error("useAnalytics must be used within AnalyticsProvider");
  return ctx;
}

interface Props {
  children: ReactNode;
  initialDateRange: { from: Date; to: Date } | null;
  initialSummary: AnalyticsSummary | null;
  initialGoalChartData: GoalChartData | null;
}

export function AnalyticsProvider({
  children,
  initialDateRange,
  initialSummary,
  initialGoalChartData,
}: Props) {
  const [fullDateRange, setFullDateRange] = useState(initialDateRange);
  const [dateRange, setDateRange] = useState(initialDateRange);
  const [activePreset, setActivePreset] = useState<PeriodPreset>("ALL");
  const [summary, setSummary] = useState(initialSummary);
  const [goalChartData] = useState(initialGoalChartData);
  const [isLoading, setIsLoading] = useState(false);

  const [contentCsv, setContentCsv] = useState<ContentCsvRow[] | null>(null);
  const [overviewCsv, setOverviewCsv] = useState<OverviewCsvRow[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);

  const handleCsvFile = useCallback((raw: string) => {
    setImportError(null);
    try {
      const type = detectCsvType(raw);
      if (type === "content") {
        const rows = parseContentCsvRows(raw);
        setContentCsv(rows);
      } else {
        const rows = parseOverviewCsvRows(raw);
        setOverviewCsv(rows);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Failed to parse CSV");
    }
  }, []);

  const clearCsvFile = useCallback((type: "content" | "overview") => {
    if (type === "content") setContentCsv(null);
    else setOverviewCsv(null);
  }, []);

  const refreshData = useCallback(async () => {
    if (!dateRange) return;
    setIsLoading(true);
    try {
      const data = await getAnalyticsSummary(dateRange.from, dateRange.to);
      setSummary(data);
    } finally {
      setIsLoading(false);
    }
  }, [dateRange]);

  const setPreset = useCallback(
    async (preset: PeriodPreset) => {
      if (!fullDateRange) return;
      setActivePreset(preset);
      setIsLoading(true);
      try {
        let from: Date;
        const to = fullDateRange.to;
        if (preset === "ALL") {
          from = fullDateRange.from;
        } else {
          const days = PRESET_DAYS[preset];
          from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        }
        const range = { from, to };
        setDateRange(range);
        const data = await getAnalyticsSummary(range.from, range.to);
        setSummary(data);
      } finally {
        setIsLoading(false);
      }
    },
    [fullDateRange]
  );

  const runImport = useCallback(async (): Promise<boolean> => {
    if (!contentCsv && !overviewCsv) return false;
    setIsImporting(true);
    setImportError(null);

    try {
      const result: ImportResult = {};

      if (contentCsv) {
        result.contentRows = contentCsv.length;
        const r = await importContentData(contentCsv);
        result.contentEnriched = r.enriched;
        result.contentSkipped = r.skipped;
      }

      if (overviewCsv) {
        result.overviewRows = overviewCsv.length;
        const r = await importDailyStats(overviewCsv);
        result.overviewImported = r.imported;
        result.overviewUpdated = r.updated;
      }

      setLastImportResult(result);
      setContentCsv(null);
      setOverviewCsv(null);

      // After import — refresh full date range and reset to ALL
      const range = dateRange ?? (await getAnalyticsDateRange());
      if (range) {
        setFullDateRange(range);
        setDateRange(range);
        setActivePreset("ALL");
        const data = await getAnalyticsSummary(range.from, range.to);
        setSummary(data);
      }

      return true;
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
      return false;
    } finally {
      setIsImporting(false);
    }
  }, [contentCsv, overviewCsv, dateRange]);

  const handleSetDateRange = useCallback(async (range: { from: Date; to: Date }) => {
    setDateRange(range);
    setIsLoading(true);
    try {
      const data = await getAnalyticsSummary(range.from, range.to);
      setSummary(data);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <AnalyticsContext.Provider
      value={{
        dateRange,
        fullDateRange,
        activePreset,
        summary,
        goalChartData,
        isLoading,
        contentCsv,
        overviewCsv,
        importError,
        isImporting,
        lastImportResult,
        handleCsvFile,
        clearCsvFile,
        runImport,
        setPreset,
        setDateRange: handleSetDateRange,
        refreshData,
      }}
    >
      {children}
    </AnalyticsContext.Provider>
  );
}
