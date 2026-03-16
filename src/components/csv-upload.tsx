"use client";

import { useRef, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface CsvUploadProps {
  value: string;
  onChange: (raw: string) => void;
}

export function CsvUpload({ value, onChange }: CsvUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onChange((ev.target?.result as string) ?? "");
    };
    reader.readAsText(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Paste CSV or upload a file from X Analytics
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="gap-1.5"
        >
          <Upload className="size-3.5" />
          Upload .csv
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFile}
        />
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'Post id,Date,Post text,...\n2027324435...,"Fri, Feb 27, 2026",...'}
        className="min-h-[140px] font-mono text-xs resize-none"
        spellCheck={false}
      />
    </div>
  );
}
