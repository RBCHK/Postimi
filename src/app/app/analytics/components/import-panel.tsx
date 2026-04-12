"use client";

import { useRef, useState } from "react";
import { Upload, X, FileText, Check, Loader2, RefreshCw } from "lucide-react";
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

type Tab = "csv" | "api";

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
  } = useAnalytics();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("csv");
  const [apiLoading, setApiLoading] = useState(false);
  const [apiResult, setApiResult] = useState<{
    imported: number;
    updated: number;
    total: number;
  } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

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
            CSV Upload
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
      </DialogContent>
    </Dialog>
  );
}
