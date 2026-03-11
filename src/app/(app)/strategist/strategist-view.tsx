"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Search, Trash2, Plus, TrendingUp, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
    analysisInProgress,
    analysisError,
    searchQueries,
    streamedText,
    profile,
    updateProfile,
    selectAnalysis,
    handleCsvInput,
    runAnalysis,
    deleteAnalysisItem,
  } = useStrategist();

  const [profileOpen, setProfileOpen] = useState(
    !profile.name && !profile.username
  );

  const [csvRaw, setCsvRaw] = useState("");
  const [showNewAnalysis, setShowNewAnalysis] = useState(analyses.length === 0);

  const selectedAnalysis = analyses.find((a) => a.id === selectedId);

  // Show analysis panel when analysis is running OR when viewing a completed analysis
  const showAnalysisPanel =
    !showNewAnalysis && (analysisInProgress || isAnalyzing || !!selectedAnalysis);

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

  const displayText = isAnalyzing
    ? streamedText
    : (selectedAnalysis?.recommendation ?? "");

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — history */}
      <div className="w-64 shrink-0 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="size-4" />
            Strategist
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleNewAnalysis}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {analyses.length === 0 && !analysisInProgress && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">
              No analyses yet
            </p>
          )}
          {analysisInProgress && (
            <div className="flex items-center gap-2 rounded-md px-2 py-2 bg-muted text-sm">
              <Loader2 className="size-3.5 animate-spin shrink-0" />
              <span className="truncate text-muted-foreground">Analyzing...</span>
            </div>
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
                  {a.csvSummary.totalPosts} posts · {a.csvSummary.avgImpressions} avg
                  imp
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
        {!showAnalysisPanel ? (
          /* Upload / input state */
          <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto">
            <h2 className="text-lg font-semibold mb-1">New Analysis</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Export CSV from X Analytics (Analytics → Export), paste it below.
            </p>

            {/* Profile section */}
            <div className="mb-5 rounded-md border">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
                onClick={() => setProfileOpen((v) => !v)}
              >
                <span>
                  Account Profile
                  {profile.username && (
                    <span className="ml-2 text-muted-foreground font-normal">
                      @{profile.username}
                      {profile.followers && ` · ${profile.followers} followers`}
                    </span>
                  )}
                </span>
                {profileOpen ? (
                  <ChevronUp className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                )}
              </button>

              {profileOpen && (
                <div className="border-t px-3 py-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        className="h-8 text-sm"
                        placeholder="Ruslan Buchak"
                        value={profile.name}
                        onChange={(e) => updateProfile({ name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Username</Label>
                      <Input
                        className="h-8 text-sm"
                        placeholder="razRBCHK"
                        value={profile.username}
                        onChange={(e) => updateProfile({ username: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Followers</Label>
                      <Input
                        className="h-8 text-sm"
                        placeholder="1200"
                        value={profile.followers}
                        onChange={(e) => updateProfile({ followers: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Following</Label>
                      <Input
                        className="h-8 text-sm"
                        placeholder="350"
                        value={profile.following}
                        onChange={(e) => updateProfile({ following: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Bio</Label>
                    <Textarea
                      className="text-sm resize-none"
                      rows={2}
                      placeholder="About you..."
                      value={profile.bio}
                      onChange={(e) => updateProfile({ bio: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            <CsvUpload value={csvRaw} onChange={handleCsvChange} />

            {csvError && (
              <p className="text-sm text-destructive mt-2">{csvError}</p>
            )}

            {analysisError && (
              <p className="text-sm text-destructive mt-2">
                Error: {analysisError}
              </p>
            )}

            {csvSummary && !csvError && (
              <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Preview</p>
                <p className="text-muted-foreground">
                  {csvSummary.totalPosts} posts · {csvSummary.dateRange.from} to{" "}
                  {csvSummary.dateRange.to} · avg {csvSummary.avgImpressions}{" "}
                  impressions
                </p>
              </div>
            )}

            <Button
              className="mt-4 w-full"
              disabled={!csvSummary || isAnalyzing || analysisInProgress}
              onClick={() => {
                setShowNewAnalysis(false);
                runAnalysis();
              }}
            >
              {analysisInProgress ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Analyzing...
                </>
              ) : (
                "Run Analysis"
              )}
            </Button>
          </div>
        ) : (
          /* Analysis output */
          <div className="flex-1 overflow-y-auto p-6">
            {/* Error in analysis panel */}
            {analysisError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 mb-4 text-sm text-destructive">
                {analysisError}
              </div>
            )}

            {/* Search queries chip bar */}
            {(analysisInProgress || searchQueries.length > 0) && (
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
                {analysisInProgress && searchQueries.length === 0 && (
                  <div className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground animate-pulse">
                    <Search className="size-3" />
                    Searching the web...
                  </div>
                )}
              </div>
            )}

            {/* Markdown output */}
            <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h2:text-lg prose-h3:text-base prose-h3:mt-4 prose-li:my-0.5 prose-p:leading-relaxed">
              <ReactMarkdown>{displayText}</ReactMarkdown>
            </div>

            {analysisInProgress && !displayText && !analysisError && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
                <Loader2 className="size-4 animate-spin" />
                Analyzing your data...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
