"use client";

import { useRef } from "react";
import { Check, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Binary counterpart to the CSV `FileDropZone`. xlsx files are zips, so we
// keep the `File` object (no `readAsText`) and hand it to the server
// action via FormData later.
interface Props {
  label: string;
  hint: string;
  file: File | null;
  onFile: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function XlsxDropZone({ label, hint, file, onFile, onClear, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    // Clear the input so the user can re-select the same file after an
    // error without the onChange being a no-op.
    if (inputRef.current) inputRef.current.value = "";
    if (picked) onFile(picked);
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{hint}</p>
        </div>
        {file ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check className="h-3.5 w-3.5" />
              <span className="max-w-[140px] truncate">{file.name}</span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClear}
              disabled={disabled}
              aria-label={`Remove ${label}`}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Choose file
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
