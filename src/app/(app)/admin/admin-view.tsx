"use client";

import { useState, useTransition } from "react";
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { toast } from "sonner";
import { toggleCronJob, getCronConfigs, getCronRuns } from "@/app/actions/admin";

// ─── Types ─────────────────────────────────────────────────

interface CronConfig {
  jobName: string;
  enabled: boolean;
  description: string | null;
  schedule: string | null;
  updatedAt: Date;
  lastRun: {
    jobName: string;
    status: string;
    startedAt: Date;
    durationMs: number | null;
  } | null;
}

interface CronRun {
  id: string;
  jobName: string;
  status: string;
  durationMs: number | null;
  resultJson: unknown;
  error: string | null;
  startedAt: Date;
}

interface AdminViewProps {
  initialConfigs: CronConfig[];
  initialRuns: CronRun[];
}

// ─── Helpers ───────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  SUCCESS: { icon: CheckCircle2, color: "text-green-600", label: "Success" },
  PARTIAL: { icon: AlertTriangle, color: "text-yellow-600", label: "Partial" },
  FAILURE: { icon: XCircle, color: "text-red-600", label: "Failure" },
  SKIPPED: { icon: SkipForward, color: "text-gray-500", label: "Skipped" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.FAILURE;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${config.color}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimeAgo(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ─── Component ─────────────────────────────────────────────

export function AdminView({ initialConfigs, initialRuns }: AdminViewProps) {
  const [tab, setTab] = useState("crons");
  const [configs, setConfigs] = useState(initialConfigs);
  const [runs, setRuns] = useState(initialRuns);
  const [isPending, startTransition] = useTransition();
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState<string>("all");

  function handleToggle(jobName: string, enabled: boolean) {
    // Optimistic update
    setConfigs((prev) => prev.map((c) => (c.jobName === jobName ? { ...c, enabled } : c)));

    startTransition(async () => {
      try {
        await toggleCronJob(jobName, enabled);
        toast.success(`${jobName}: ${enabled ? "enabled" : "disabled"}`);
      } catch {
        // Revert on error
        setConfigs((prev) =>
          prev.map((c) => (c.jobName === jobName ? { ...c, enabled: !enabled } : c))
        );
        toast.error("Failed to toggle job");
      }
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      try {
        const [newConfigs, newRuns] = await Promise.all([
          getCronConfigs(),
          getCronRuns({ limit: 50 }),
        ]);
        setConfigs(newConfigs);
        setRuns(newRuns);
        toast.success("Refreshed");
      } catch {
        toast.error("Failed to refresh");
      }
    });
  }

  const filteredRuns = runFilter === "all" ? runs : runs.filter((r) => r.jobName === runFilter);

  const uniqueJobNames = Array.from(new Set(runs.map((r) => r.jobName))).sort();

  return (
    <PageContainer className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="crons">Cron Jobs</TabsTrigger>
          <TabsTrigger value="runs">Run Log</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "crons" && (
        <div className="space-y-2">
          {configs.map((config) => (
            <div
              key={config.jobName}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{config.jobName}</span>
                  {config.schedule && (
                    <span className="text-xs text-muted-foreground">
                      <Clock className="mr-1 inline h-3 w-3" />
                      {config.schedule}
                    </span>
                  )}
                </div>
                {config.description && (
                  <p className="text-sm text-muted-foreground">{config.description}</p>
                )}
                {config.lastRun && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={config.lastRun.status} />
                    <span>{formatTimeAgo(config.lastRun.startedAt)}</span>
                    <span>{formatDuration(config.lastRun.durationMs)}</span>
                  </div>
                )}
              </div>
              <Switch
                checked={config.enabled}
                onCheckedChange={(checked) => handleToggle(config.jobName, checked)}
              />
            </div>
          ))}
        </div>
      )}

      {tab === "runs" && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex gap-2 overflow-x-auto">
            <Button
              variant={runFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setRunFilter("all")}
            >
              All
            </Button>
            {uniqueJobNames.map((name) => (
              <Button
                key={name}
                variant={runFilter === name ? "default" : "outline"}
                size="sm"
                onClick={() => setRunFilter(name)}
              >
                {name}
              </Button>
            ))}
          </div>

          {/* Runs list */}
          <div className="space-y-2">
            {filteredRuns.length === 0 && (
              <p className="py-8 text-center text-muted-foreground">No runs found</p>
            )}
            {filteredRuns.map((run) => (
              <div key={run.id} className="rounded-lg border">
                <button
                  className="flex w-full items-center justify-between p-4 text-left"
                  onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} />
                    <span className="font-medium">{run.jobName}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(run.durationMs)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatTimeAgo(run.startedAt)}
                    </span>
                    {expandedRunId === run.id ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>
                {expandedRunId === run.id && (
                  <div className="border-t px-4 py-3 text-sm">
                    <div className="text-xs text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </div>
                    {run.error && (
                      <pre className="mt-2 max-h-40 overflow-auto rounded bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
                        {run.error}
                      </pre>
                    )}
                    {run.resultJson != null && (
                      <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-2 text-xs">
                        {String(JSON.stringify(run.resultJson, null, 2))}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
