"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, FileText, Check, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnalytics } from "@/contexts/analytics-context";
import { importFromXApi } from "@/app/actions/x-import";
import { importLinkedInXlsx } from "@/app/actions/linkedin-xlsx";
import type { LinkedInXlsxImportResult } from "@/app/actions/linkedin-xlsx-types";
import { XlsxDropZone } from "./xlsx-drop-zone";

// LinkedIn exposes two analytics pages (Content + Audience) but both export
// the same xlsx. We link only one to avoid "which button do I click?" confusion.
const LINKEDIN_ANALYTICS_URL = "https://www.linkedin.com/analytics/creator/content/";

function FileDropZone({
  label,
  hint,
  hasData,
  dataInfo,
  onFile,
  onClear,
}: {
  label: string;
  hint: string;
  hasData: boolean;
  dataInfo?: string;
  onFile: (raw: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onFile(reader.result);
    };
    reader.readAsText(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {hasData ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check className="h-3.5 w-3.5" />
              {dataInfo}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClear}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Choose file
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

type Tab = "csv" | "api" | "linkedin";

export function ImportPanel() {
  const {
    contentCsv,
    overviewCsv,
    importError,
    isImporting,
    lastImportResult,
    handleCsvFile,
    clearCsvFile,
    runImport,
    bumpSocialRefresh,
  } = useAnalytics();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("csv");
  const [apiLoading, setApiLoading] = useState(false);
  const [apiResult, setApiResult] = useState<{
    imported: number;
    updated: number;
    total: number;
  } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [linkedInFile, setLinkedInFile] = useState<File | null>(null);
  const [linkedInLoading, setLinkedInLoading] = useState(false);
  const [linkedInResult, setLinkedInResult] = useState<LinkedInXlsxImportResult | null>(null);
  const [linkedInError, setLinkedInError] = useState<string | null>(null);

  const hasAnyData = !!contentCsv || !!overviewCsv;

  const dialogTitle = tab === "linkedin" ? "Import LinkedIn Analytics" : "Import X Analytics";

  async function handleCsvImport() {
    const success = await runImport();
    if (success) {
      setTimeout(() => setOpen(false), 1500);
    }
  }

  async function handleApiImport() {
    setApiLoading(true);
    setApiError(null);
    setApiResult(null);
    try {
      const result = await importFromXApi(100);
      setApiResult(result);
      setTimeout(() => setOpen(false), 2000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setApiLoading(false);
    }
  }

  async function handleLinkedInImport() {
    if (!linkedInFile) return;

    setLinkedInLoading(true);
    setLinkedInError(null);
    setLinkedInResult(null);

    try {
      const fd = new FormData();
      fd.set("file", linkedInFile);
      const result = await importLinkedInXlsx(fd);
      setLinkedInResult(result);
      setLinkedInFile(null);
      // Refresh both layers: `bumpSocialRefresh` nudges client-side fetches
      // in `SocialPlatformOverview`; `router.refresh()` re-runs the server
      // page so connected-platform state picks up the new data.
      bumpSocialRefresh();
      router.refresh();
    } catch (err) {
      setLinkedInError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLinkedInLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          Import Data
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="csv">X CSV</TabsTrigger>
            <TabsTrigger value="api">X API</TabsTrigger>
            <TabsTrigger value="linkedin">LinkedIn</TabsTrigger>
          </TabsList>

          <TabsContent value="csv" className="space-y-3">
            <FileDropZone
              label="Content CSV"
              hint="Posts & Replies with metrics"
              hasData={!!contentCsv}
              dataInfo={
                contentCsv
                  ? `${contentCsv.filter((r) => r.postType === "Post").length} posts, ${contentCsv.filter((r) => r.postType === "Reply").length} replies`
                  : undefined
              }
              onFile={handleCsvFile}
              onClear={() => clearCsvFile("content")}
            />

            <FileDropZone
              label="Account Overview CSV"
              hint="Daily account stats (followers, visits)"
              hasData={!!overviewCsv}
              dataInfo={overviewCsv ? `${overviewCsv.length} days` : undefined}
              onFile={handleCsvFile}
              onClear={() => clearCsvFile("overview")}
            />

            {importError && <p className="text-sm text-destructive">{importError}</p>}

            {lastImportResult && (
              <div className="rounded-md bg-muted p-3 text-xs">
                {lastImportResult.contentEnriched !== undefined && (
                  <p>
                    Content: {lastImportResult.contentEnriched} enriched,{" "}
                    {lastImportResult.contentSkipped} skipped (no API data)
                  </p>
                )}
                {lastImportResult.overviewImported !== undefined && (
                  <p>
                    Overview: {lastImportResult.overviewImported} imported,{" "}
                    {lastImportResult.overviewUpdated} updated
                  </p>
                )}
              </div>
            )}

            <Button
              className="w-full"
              disabled={!hasAnyData || isImporting}
              onClick={handleCsvImport}
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import to Database"
              )}
            </Button>
          </TabsContent>

          <TabsContent value="api" className="space-y-3">
            <div className="rounded-lg border border-border p-4 space-y-1">
              <p className="text-sm font-medium">Fetch from X API</p>
              <p className="text-xs text-muted-foreground">
                Imports your latest 100 tweets with engagement metrics directly from X.
              </p>
              <p className="text-xs text-muted-foreground">
                Note: unfollows and profile visits are not available via API — use CSV for complete
                data.
              </p>
            </div>

            {apiError && <p className="text-sm text-destructive">{apiError}</p>}

            {apiResult && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="text-green-600 font-medium flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  Done
                </p>
                <p>Fetched: {apiResult.total} tweets</p>
                <p>
                  New: {apiResult.imported} · Updated: {apiResult.updated}
                </p>
              </div>
            )}

            <Button className="w-full" disabled={apiLoading} onClick={handleApiImport}>
              {apiLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Fetching from X...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Fetch Latest Tweets
                </>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="linkedin" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              LinkedIn&apos;s analytics API is gated for new apps, so xlsx export is the only path.
              Open LinkedIn Analytics, click <span className="font-medium">Export</span>, pick a
              date range, then drop the file here.
            </p>
            <a
              href={LINKEDIN_ANALYTICS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary [@media(hover:hover)]:hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open LinkedIn Analytics
            </a>

            <XlsxDropZone
              label="Drop xlsx here"
              hint="Posts, engagement, followers, demographics"
              file={linkedInFile}
              onFile={setLinkedInFile}
              onClear={() => setLinkedInFile(null)}
              disabled={linkedInLoading}
            />

            {linkedInError && <p className="text-sm text-destructive">{linkedInError}</p>}

            {linkedInResult && (
              <div className="rounded-md bg-muted p-3 text-xs space-y-0.5">
                <p className="text-green-600 font-medium flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  File imported
                </p>
                <p>
                  Posts: {linkedInResult.postsImported} new · {linkedInResult.postsUpdated} updated
                </p>
                <p>
                  Daily stats: {linkedInResult.dailyStatsUpserted} days · Follower snapshots:{" "}
                  {linkedInResult.followerSnapshotsUpserted}
                </p>
                {linkedInResult.totalFollowers > 0 && (
                  <p>Total followers: {linkedInResult.totalFollowers.toLocaleString()}</p>
                )}
                {linkedInResult.windowStart && linkedInResult.windowEnd && (
                  <p className="text-muted-foreground">
                    Window: {linkedInResult.windowStart.slice(0, 10)} →{" "}
                    {linkedInResult.windowEnd.slice(0, 10)}
                  </p>
                )}
              </div>
            )}

            <Button
              className="w-full"
              disabled={linkedInLoading || !linkedInFile}
              onClick={handleLinkedInImport}
            >
              {linkedInLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Parsing xlsx...
                </>
              ) : (
                <>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Import
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
