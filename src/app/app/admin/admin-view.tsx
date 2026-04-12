"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Play,
  Loader2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SectionLabel } from "@/components/section-label";
import { toast } from "sonner";
import {
  toggleCronJob,
  getCronConfigs,
  getCronRuns,
  getApiCostSummary,
  getApiCostDaily,
} from "@/app/actions/admin";
import {
  MODEL_OPTIONS,
  MODEL_STORAGE_KEY,
  getStoredModel,
  getStoredAgentModel,
  setStoredAgentModel,
  type AgentKey,
} from "@/lib/model";

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

interface CostSummary {
  period: string;
  totalCostCents: number;
  totalResources: number;
  totalCalls: number;
}

interface CostDaily {
  date: string;
  costCents: number;
  calls: number;
  resources: number;
}

interface AdminViewProps {
  initialConfigs: CronConfig[];
  initialRuns: CronRun[];
}

// ─── Agent model config ─────────────────────────────────────

/** Maps CronJobConfig.jobName → AgentKey for jobs that use AI models */
const JOB_MODEL_KEY: Record<string, AgentKey> = {
  "daily-insight": "dailyInsight",
  researcher: "researcher",
  strategist: "strategist",
};

/** Maps CronJobConfig.jobName → cron API path */
const CRON_PATHS: Record<string, string> = {
  "followers-snapshot": "/api/cron/followers-snapshot",
  "trend-snapshot": "/api/cron/trend-snapshot",
  "daily-insight": "/api/cron/daily-insight",
  "x-import": "/api/cron/x-import",
  researcher: "/api/cron/researcher",
  strategist: "/api/cron/strategist",
};

/** Schedule times from vercel.json, displayed as UTC (PST) */
const JOB_SCHEDULES: Record<string, string[]> = {
  "followers-snapshot": ["Daily 06:00 UTC (22:00 PST)"],
  "trend-snapshot": [
    "Daily 08:00 UTC (00:00 PST)",
    "Daily 12:00 UTC (04:00 PST)",
    "Daily 16:15 UTC (08:15 PST)",
    "Daily 20:00 UTC (12:00 PST)",
  ],
  "daily-insight": ["Daily 16:30 UTC (08:30 PST)"],
  "x-import": ["Mon 04:00 UTC (Sun 20:00 PST) — full", "Daily 12:00 UTC (04:00 PST) — refresh"],
  researcher: ["Mon 04:30 UTC (Sun 20:30 PST)"],
  strategist: ["Mon 14:00 UTC (06:00 PST)"],
};

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

function formatCents(cents: number): string {
  if (cents < 1) return `$${cents.toFixed(3)}`;
  if (cents < 100) return `${cents.toFixed(1)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── Component ─────────────────────────────────────────────

export function AdminView({ initialConfigs, initialRuns }: AdminViewProps) {
  const [tab, setTab] = useState("crons");
  const [configs, setConfigs] = useState(initialConfigs);
  const [runs, setRuns] = useState(initialRuns);
  const [isPending, startTransition] = useTransition();
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState<string>("all");

  // Manual run state
  const [running, setRunning] = useState<string | null>(null);

  // Agent model state (from localStorage)
  const [agentModels, setAgentModels] = useState<Partial<Record<AgentKey, string>>>({});
  const [chatModel, setChatModel] = useState<string>(MODEL_OPTIONS[0].value);

  // API Costs state
  const [costSummaries, setCostSummaries] = useState<CostSummary[]>([]);
  const [costDaily, setCostDaily] = useState<CostDaily[]>([]);
  const [costsLoaded, setCostsLoaded] = useState(false);

  // Load models from localStorage on mount
  useEffect(() => {
    setChatModel(getStoredModel());
    const entries = Object.entries(JOB_MODEL_KEY).map(([, agentKey]) => [
      agentKey,
      getStoredAgentModel(agentKey),
    ]);
    setAgentModels(Object.fromEntries(entries));
  }, []);

  function handleModelChange(agentKey: AgentKey, value: string) {
    setStoredAgentModel(agentKey, value);
    setAgentModels((prev) => ({ ...prev, [agentKey]: value }));
    toast.success("Model saved");
  }

  function handleChatModelChange(value: string) {
    setChatModel(value);
    localStorage.setItem(MODEL_STORAGE_KEY, value);
    toast.success("Chat model saved");
  }

  async function handleRun(jobName: string) {
    if (running) return;
    const cronPath = CRON_PATHS[jobName];
    if (!cronPath) return;
    setRunning(jobName);
    try {
      const res = await fetch(cronPath);
      const data = await res.json();
      if (data.ok) {
        toast.success(`${jobName} completed`);
        // Refresh data
        const [newConfigs, newRuns] = await Promise.all([
          getCronConfigs(),
          getCronRuns({ limit: 50 }),
        ]);
        setConfigs(newConfigs);
        setRuns(newRuns);
      } else {
        toast.error(`${jobName} failed: ${data.error ?? `HTTP ${res.status}`}`);
      }
    } catch (err) {
      toast.error(`${jobName} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(null);
    }
  }

  const loadCosts = useCallback(() => {
    startTransition(async () => {
      try {
        const [today, week, month, daily] = await Promise.all([
          getApiCostSummary("today"),
          getApiCostSummary("week"),
          getApiCostSummary("month"),
          getApiCostDaily(14),
        ]);
        setCostSummaries([today, week, month]);
        setCostDaily(daily);
        setCostsLoaded(true);
      } catch {
        toast.error("Failed to load API costs");
      }
    });
  }, []);

  // Load costs when switching to costs tab
  useEffect(() => {
    if (tab === "costs" && !costsLoaded) {
      loadCosts();
    }
  }, [tab, costsLoaded, loadCosts]);

  function handleToggle(jobName: string, enabled: boolean) {
    setConfigs((prev) => prev.map((c) => (c.jobName === jobName ? { ...c, enabled } : c)));

    startTransition(async () => {
      try {
        await toggleCronJob(jobName, enabled);
        toast.success(`${jobName}: ${enabled ? "enabled" : "disabled"}`);
      } catch {
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
        if (tab === "costs") {
          setCostsLoaded(false);
        }
        toast.success("Refreshed");
      } catch {
        toast.error("Failed to refresh");
      }
    });
  }

  const filteredRuns = runFilter === "all" ? runs : runs.filter((r) => r.jobName === runFilter);
  const uniqueJobNames = Array.from(new Set(runs.map((r) => r.jobName))).sort();

  const PERIOD_LABELS: Record<string, string> = {
    today: "Today",
    week: "7 days",
    month: "30 days",
  };

  return (
    <PageContainer className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Admin">
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </PageHeader>

      <div className="flex flex-1 min-h-0 justify-center overflow-y-auto">
        <div className="w-full max-w-3xl space-y-6 pb-8">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="crons">Cron Jobs</TabsTrigger>
              <TabsTrigger value="runs">Run Log</TabsTrigger>
              <TabsTrigger value="costs">API Costs</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* ─── Cron Jobs Tab ─────────────────────────────────── */}
          {tab === "crons" && (
            <div className="space-y-6">
              {[
                { title: "Agents", items: configs.filter((c) => c.jobName in JOB_MODEL_KEY) },
                {
                  title: "API Requests",
                  items: configs.filter((c) => !(c.jobName in JOB_MODEL_KEY)),
                },
              ].map(({ title, items }) => (
                <div key={title} className="space-y-2">
                  <SectionLabel>{title}</SectionLabel>
                  {items.map((config) => {
                    const modelKey = JOB_MODEL_KEY[config.jobName];
                    const canRun = !!CRON_PATHS[config.jobName];
                    const schedules = JOB_SCHEDULES[config.jobName];
                    return (
                      <div
                        key={config.jobName}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <span className="font-medium">{config.jobName}</span>
                          {schedules && (
                            <div className="flex items-start gap-1 text-xs text-muted-foreground">
                              <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                              <div>
                                {schedules.map((s, i) => (
                                  <div key={i}>{s}</div>
                                ))}
                              </div>
                            </div>
                          )}
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
                        <div className="flex items-center gap-2 shrink-0">
                          {modelKey && (
                            <Select
                              value={agentModels[modelKey] ?? MODEL_OPTIONS[0].value}
                              onValueChange={(v) => handleModelChange(modelKey, v)}
                            >
                              <SelectTrigger className="h-8 w-fit gap-1 border-0 bg-transparent px-1 text-xs text-muted-foreground shadow-none focus:ring-0 focus:ring-offset-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {MODEL_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                    {opt.shortLabel}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {canRun && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9"
                              disabled={running !== null}
                              onClick={() => handleRun(config.jobName)}
                              aria-label={`Run ${config.jobName}`}
                            >
                              {running === config.jobName ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Switch
                            checked={config.enabled}
                            onCheckedChange={(checked) => handleToggle(config.jobName, checked)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* ─── Run Log Tab ───────────────────────────────────── */}
          {tab === "runs" && (
            <div className="space-y-4">
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

              <div className="space-y-2">
                {filteredRuns.length === 0 && <EmptyState message="No runs found" />}
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

          {/* ─── API Costs Tab ─────────────────────────────────── */}
          {tab === "costs" && (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {costSummaries.map((s) => (
                  <div key={s.period} className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">
                      {PERIOD_LABELS[s.period] ?? s.period}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xl font-semibold">{formatCents(s.totalCostCents)}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.totalCalls} calls · {s.totalResources} resources
                    </div>
                  </div>
                ))}
              </div>

              {/* Daily breakdown table */}
              {costDaily.length > 0 ? (
                <div className="rounded-lg border">
                  <div className="border-b px-4 py-3 font-medium">Daily breakdown (14 days)</div>
                  <div className="divide-y">
                    {costDaily.map((day) => (
                      <div
                        key={day.date}
                        className="flex items-center justify-between px-4 py-2 text-sm"
                      >
                        <span className="text-muted-foreground">{day.date}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-muted-foreground">
                            {day.calls} calls · {day.resources} res
                          </span>
                          <span className="font-medium">{formatCents(day.costCents)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                !isPending && (
                  <p className="py-8 text-center text-muted-foreground">
                    No API cost data yet. Costs will appear after X API calls are logged.
                  </p>
                )
              )}
            </div>
          )}
          {/* ─── Models Tab ─────────────────────────────────────── */}
          {tab === "models" && (
            <div className="max-w-md space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Chat Model</label>
                <p className="text-xs text-muted-foreground">
                  Model used for the analyst chat conversations
                </p>
                <Select value={chatModel} onValueChange={handleChatModelChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
