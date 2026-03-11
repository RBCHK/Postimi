"use client";

import { useRef, useState } from "react";
import { Upload, X, FileText, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAnalytics } from "@/contexts/analytics-context";

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
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
  const hasAnyData = !!contentCsv || !!overviewCsv;

  async function handleImport() {
    const success = await runImport();
    if (success) {
      setTimeout(() => setOpen(false), 1500);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import X Analytics Data</DialogTitle>
        </DialogHeader>

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

          {importError && (
            <p className="text-sm text-destructive">{importError}</p>
          )}

          {lastImportResult && (
            <div className="rounded-md bg-muted p-3 text-xs">
              {lastImportResult.contentImported !== undefined && (
                <p>
                  Content: {lastImportResult.contentImported} imported,{" "}
                  {lastImportResult.contentUpdated} updated
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
            onClick={handleImport}
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
      </DialogContent>
    </Dialog>
  );
}
