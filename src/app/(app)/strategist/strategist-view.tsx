"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Search, Trash2, Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CsvUpload } from "@/components/csv-upload";
import { useStrategist } from "@/contexts/strategist-context";
import { deleteAnalysis } from "@/app/actions/strategist";

export function StrategistView() {
  const {
    analyses,
    selectedId,
    csvSummary,
    csvError,
    isAnalyzing,
    searchQueries,
    streamedText,
    selectAnalysis,
    handleCsvInput,
    runAnalysis,
    deleteAnalysisItem,
  } = useStrategist();

  const [csvRaw, setCsvRaw] = useState("");
  const [showNewAnalysis, setShowNewAnalysis] = useState(analyses.length === 0);

  const selectedAnalysis = analyses.find((a) => a.id === selectedId);

  function handleCsvChange(raw: string) {
    setCsvRaw(raw);
    handleCsvInput(raw);
  }

  function handleNewAnalysis() {
    setCsvRaw("");
    handleCsvInput("");
    selectAnalysis(null);
    setShowNewAnalysis(true);
  }

  async function handleDelete(id: string) {
    deleteAnalysisItem(id);
    await deleteAnalysis(id);
  }

  const displayText = isAnalyzing ? streamedText : (selectedAnalysis?.recommendation ?? "");

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — history */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="size-4" />
            Strategist
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={handleNewAnalysis}>
            <Plus className="size-3.5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {analyses.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">
              No analyses yet
            </p>
          )}
          {analyses.map((a) => (
            <div
              key={a.id}
              className={`group flex items-start justify-between rounded-md px-2 py-2 cursor-pointer hover:bg-muted/50 text-sm ${
                selectedId === a.id && !showNewAnalysis ? "bg-muted" : ""
              }`}
              onClick={() => {
                setShowNewAnalysis(false);
                selectAnalysis(a.id);
              }}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {a.csvSummary.dateRange.from} –
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.csvSummary.dateRange.to}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.csvSummary.totalPosts} posts · {a.csvSummary.avgImpressions} avg imp
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(a.id);
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showNewAnalysis || (!selectedAnalysis && !isAnalyzing) ? (
          /* Upload / input state */
          <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto">
            <h2 className="text-lg font-semibold mb-1">New Analysis</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Export CSV from X Analytics (Analytics → Export), paste it below.
            </p>

            <CsvUpload value={csvRaw} onChange={handleCsvChange} />

            {csvError && (
              <p className="text-sm text-destructive mt-2">{csvError}</p>
            )}

            {csvSummary && !csvError && (
              <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Preview</p>
                <p className="text-muted-foreground">
                  {csvSummary.totalPosts} posts · {csvSummary.dateRange.from} to{" "}
                  {csvSummary.dateRange.to} · avg {csvSummary.avgImpressions} impressions
                </p>
              </div>
            )}

            <Button
              className="mt-4 w-full"
              disabled={!csvSummary || isAnalyzing}
              onClick={() => {
                setShowNewAnalysis(false);
                runAnalysis();
              }}
            >
              {isAnalyzing ? "Analyzing..." : "Run Analysis"}
            </Button>
          </div>
        ) : (
          /* Analysis output */
          <div className="flex-1 overflow-y-auto p-6">
            {/* Search queries chip bar */}
            {(isAnalyzing || searchQueries.length > 0) && (
              <div className="flex flex-wrap gap-2 mb-4">
                {searchQueries.map((q, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                  >
                    <Search className="size-3" />
                    {q}
                  </div>
                ))}
                {isAnalyzing && searchQueries.length === 0 && (
                  <div className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground animate-pulse">
                    <Search className="size-3" />
                    Searching the web...
                  </div>
                )}
              </div>
            )}

            {/* Markdown output */}
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{displayText}</ReactMarkdown>
            </div>

            {isAnalyzing && !displayText && (
              <p className="text-sm text-muted-foreground animate-pulse">
                Analyzing your data...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
