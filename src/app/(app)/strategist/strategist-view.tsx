"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Search,
  Trash2,
  Plus,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Bot,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CsvUpload } from "@/components/csv-upload";
import { useStrategist } from "@/contexts/strategist-context";
import { deleteAnalysis } from "@/app/actions/strategist";
import { PageContainer } from "@/components/page-container";

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
    researchNotes,
    selectedResearchId,
    leftTab,
    setLeftTab,
    selectResearchNote,
  } = useStrategist();

  const [profileOpen, setProfileOpen] = useState(!profile.name && !profile.username);
  const [csvRaw, setCsvRaw] = useState("");
  const [showNewAnalysis, setShowNewAnalysis] = useState(analyses.length === 0);

  const selectedAnalysis = analyses.find((a) => a.id === selectedId);
  const selectedResearch = researchNotes.find((n) => n.id === selectedResearchId);
  const showAnalysisPanel =
    !showNewAnalysis && (analysisInProgress || isAnalyzing || !!selectedAnalysis);

  const mobileShowContent =
    leftTab === "analyses" ? showAnalysisPanel || showNewAnalysis : !!selectedResearch;

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

  function handleMobileBack() {
    selectAnalysis(null);
    setShowNewAnalysis(false);
  }

  const displayText = isAnalyzing ? streamedText : (selectedAnalysis?.recommendation ?? "");

  const NAV = [
    { id: "analyses" as const, label: "Analyses" },
    { id: "research" as const, label: "Research" },
  ];

  return (
    <PageContainer className="flex flex-col h-full overflow-hidden">
      {/* Title row */}
      <div className="flex items-center justify-between mb-4 md:mb-6 shrink-0">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Strategist</h1>
        {leftTab === "analyses" && !mobileShowContent && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={handleNewAnalysis}
          >
            <Plus className="size-3.5" />
            New
          </Button>
        )}
        {leftTab === "analyses" && mobileShowContent && (
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={handleNewAnalysis}
          >
            <Plus className="size-3.5" />
            New
          </Button>
        )}
      </div>

      {/* Mobile: horizontal tabs */}
      <div className="md:hidden flex gap-1 overflow-x-auto pb-2 shrink-0">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setLeftTab(item.id)}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              leftTab === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0 gap-0 md:gap-8">
        {/* Sidebar */}
        <nav
          className={`flex-col gap-0.5 w-full md:w-44 shrink-0 ${mobileShowContent ? "hidden md:flex" : "flex"}`}
        >
          {/* Desktop tab switcher */}
          <div className="hidden md:flex gap-1 mb-2">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => setLeftTab(item.id)}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  leftTab === item.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:bg-muted/60"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-0.5">
            {leftTab === "analyses" ? (
              <>
                {analyses.length === 0 && !analysisInProgress && (
                  <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                    No analyses yet
                  </p>
                )}
                {analysisInProgress && (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground rounded-md">
                    <Loader2 className="size-3.5 animate-spin shrink-0" />
                    <span className="truncate">Analyzing...</span>
                  </div>
                )}
                {analyses.map((a) => (
                  <div
                    key={a.id}
                    className={`group flex items-start justify-between px-3 py-2 rounded-md cursor-pointer transition-colors text-sm ${
                      selectedId === a.id && !showNewAnalysis
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:bg-muted/60"
                    }`}
                    onClick={() => {
                      setShowNewAnalysis(false);
                      selectAnalysis(a.id);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs">
                          {a.csvSummary.dateRange.from} – {a.csvSummary.dateRange.to}
                        </span>
                        {a.autoGenerated && (
                          <Bot className="size-3 shrink-0 text-muted-foreground" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {a.csvSummary.totalPosts} posts · {a.csvSummary.avgImpressions} avg
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
              </>
            ) : (
              <>
                {researchNotes.length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                    No research notes yet
                  </p>
                )}
                {researchNotes.map((n) => (
                  <div
                    key={n.id}
                    className={`px-3 py-2 rounded-md cursor-pointer transition-colors text-sm ${
                      selectedResearchId === n.id
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:bg-muted/60"
                    }`}
                    onClick={() => selectResearchNote(n.id)}
                  >
                    <p className="truncate text-xs">{n.topic}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {n.createdAt.toLocaleDateString("ru-RU")} · {n.sources.length} sources
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
        </nav>

        {/* Content */}
        <div
          className={`flex-1 min-w-0 overflow-y-auto flex-col ${mobileShowContent ? "flex" : "hidden md:flex"}`}
        >
          {/* Mobile back */}
          {leftTab === "analyses" && (
            <button
              className="md:hidden flex items-center gap-1.5 text-xs text-muted-foreground mb-4 min-h-[44px]"
              onClick={handleMobileBack}
            >
              <ArrowLeft className="size-3.5" />
              Back
            </button>
          )}

          {leftTab === "research" ? (
            selectedResearch ? (
              <div className="max-w-2xl pb-8">
                <h2 className="text-lg font-semibold mb-1">{selectedResearch.topic}</h2>
                <p className="text-xs text-muted-foreground mb-4">
                  {selectedResearch.createdAt.toLocaleDateString("ru-RU")} ·{" "}
                  {selectedResearch.sources.length} sources
                </p>
                <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
                  <ReactMarkdown>{selectedResearch.summary}</ReactMarkdown>
                </div>
                {selectedResearch.sources.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Sources</h3>
                    {selectedResearch.sources.map((s, i) => (
                      <div key={i} className="rounded-md border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-tight">{s.title}</p>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-muted-foreground [@media(hover:hover)]:hover:text-foreground"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                        {s.snippet && (
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            {s.snippet}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {selectedResearch.queries.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedResearch.queries.map((q, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-normal">
                        <Search className="size-3 mr-1" />
                        {q}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden md:flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">Select a research note</p>
              </div>
            )
          ) : !showAnalysisPanel ? (
            <div className="max-w-2xl w-full pb-8">
              <h2 className="text-lg font-semibold mb-1">New Analysis</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Export CSV from X Analytics (Analytics → Export), paste it below.
              </p>

              <div className="mb-5 rounded-md border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium [@media(hover:hover)]:hover:bg-muted/40 transition-colors"
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

              {csvError && <p className="text-sm text-destructive mt-2">{csvError}</p>}
              {analysisError && (
                <p className="text-sm text-destructive mt-2">Error: {analysisError}</p>
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
            <div className="max-w-2xl w-full pb-8">
              {analysisError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 mb-4 text-sm text-destructive">
                  {analysisError}
                </div>
              )}
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
    </PageContainer>
  );
}
