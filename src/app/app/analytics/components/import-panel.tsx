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
import { useAnalytics } from "@/contexts/analytics-context";
import { importFromXApi } from "@/app/actions/x-import";
import { importLinkedInXlsx } from "@/app/actions/linkedin-xlsx";
import {
  EMPTY_LI_RESULT,
  mergeLinkedInResult,
  type LinkedInAggregatedResult,
} from "./linkedin-aggregate";
import { XlsxDropZone } from "./xlsx-drop-zone";

// Where the user exports the xlsx that this panel accepts.
const LINKEDIN_CONTENT_ANALYTICS_URL = "https://www.linkedin.com/analytics/creator/content/";
const LINKEDIN_AUDIENCE_ANALYTICS_URL = "https://www.linkedin.com/analytics/creator/audience/";

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
  const [linkedInContentFile, setLinkedInContentFile] = useState<File | null>(null);
  const [linkedInAudienceFile, setLinkedInAudienceFile] = useState<File | null>(null);
  const [linkedInLoading, setLinkedInLoading] = useState(false);
  const [linkedInResult, setLinkedInResult] = useState<LinkedInAggregatedResult | null>(null);
  const [linkedInError, setLinkedInError] = useState<string | null>(null);

  const hasAnyData = !!contentCsv || !!overviewCsv;

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
    const files = [linkedInContentFile, linkedInAudienceFile].filter((f): f is File => f !== null);
    if (files.length === 0) return;

    setLinkedInLoading(true);
    setLinkedInError(null);
    setLinkedInResult(EMPTY_LI_RESULT);

    let agg: LinkedInAggregatedResult = EMPTY_LI_RESULT;
    const failures: { name: string; error: string }[] = [];

    // Sequential, not parallel: the server action holds the workbook in
    // memory and runs Prisma upserts; serialising is safer for a 2-file
    // flow and keeps partial-failure reporting simple.
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.set("file", file);
        const result = await importLinkedInXlsx(fd);
        agg = mergeLinkedInResult(agg, result);
        setLinkedInResult(agg);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed";
        failures.push({ name: file.name, error: message });
        agg = { ...agg, filesFailed: [...agg.filesFailed, file.name] };
        setLinkedInResult(agg);
      }
    }

    if (failures.length > 0) {
      setLinkedInError(failures.map((f) => `${f.name}: ${f.error}`).join(" · "));
    }

    // Clear slots once imported so the next visit starts fresh.
    setLinkedInContentFile(null);
    setLinkedInAudienceFile(null);

    // Refresh both layers: `bumpSocialRefresh` nudges client-side fetches in
    // `SocialPlatformOverview`; `router.refresh()` re-runs the server page so
    // date range / connected-platform state picks up the new data.
    bumpSocialRefresh();
    router.refresh();
    setLinkedInLoading(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          Import Data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import X Analytics Data</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          <button
            className={`flex-1 px-3 py-2 text-center transition-colors ${
              tab === "csv"
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setTab("csv")}
          >
            X CSV
          </button>
          <button
            className={`flex-1 px-3 py-2 text-center transition-colors ${
              tab === "api"
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setTab("api")}
          >
            X API
          </button>
          <button
            className={`flex-1 px-3 py-2 text-center transition-colors ${
              tab === "linkedin"
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setTab("linkedin")}
          >
            LinkedIn
          </button>
        </div>

        {tab === "csv" && (
          <div className="space-y-3">
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
          </div>
        )}

        {tab === "api" && (
          <div className="space-y-3">
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
          </div>
        )}

        {tab === "linkedin" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-4 space-y-2">
              <p className="text-sm font-medium">Upload LinkedIn Analytics exports</p>
              <p className="text-xs text-muted-foreground">
                LinkedIn&apos;s analytics API is gated for new apps, so xlsx export is the only
                path. Open each page, click <span className="font-medium">Export</span>, pick a date
                range, then drop both xlsx files below.
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                <a
                  href={LINKEDIN_CONTENT_ANALYTICS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Content analytics
                </a>
                <a
                  href={LINKEDIN_AUDIENCE_ANALYTICS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Audience analytics
                </a>
              </div>
            </div>

            <XlsxDropZone
              label="Content export"
              hint="Posts + engagement + top posts"
              file={linkedInContentFile}
              onFile={setLinkedInContentFile}
              onClear={() => setLinkedInContentFile(null)}
              disabled={linkedInLoading}
            />

            <XlsxDropZone
              label="Audience export"
              hint="Followers + demographics"
              file={linkedInAudienceFile}
              onFile={setLinkedInAudienceFile}
              onClear={() => setLinkedInAudienceFile(null)}
              disabled={linkedInLoading}
            />

            {linkedInError && <p className="text-sm text-destructive">{linkedInError}</p>}

            {linkedInResult && linkedInResult.filesProcessed > 0 && (
              <div className="rounded-md bg-muted p-3 text-xs space-y-0.5">
                <p className="text-green-600 font-medium flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  {linkedInResult.filesProcessed === 1
                    ? "1 file imported"
                    : `${linkedInResult.filesProcessed} files imported`}
                  {linkedInResult.filesFailed.length > 0 &&
                    ` · ${linkedInResult.filesFailed.length} failed`}
                </p>
                <p>
                  Posts: {linkedInResult.postsImported} new · {linkedInResult.postsUpdated} updated
                </p>
                <p>
                  Daily stats: {linkedInResult.dailyStatsUpserted} days · Follower snapshots:{" "}
                  {linkedInResult.followerSnapshotsUpserted}
                </p>
                {linkedInResult.latestTotalFollowers > 0 && (
                  <p>Total followers: {linkedInResult.latestTotalFollowers.toLocaleString()}</p>
                )}
                {linkedInResult.earliestWindowStart && linkedInResult.latestWindowEnd && (
                  <p className="text-muted-foreground">
                    Window: {linkedInResult.earliestWindowStart.slice(0, 10)} →{" "}
                    {linkedInResult.latestWindowEnd.slice(0, 10)}
                  </p>
                )}
              </div>
            )}

            <Button
              className="w-full"
              disabled={linkedInLoading || (!linkedInContentFile && !linkedInAudienceFile)}
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
