"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { getVoiceBankEntries, addVoiceBankEntry, removeVoiceBankEntry } from "@/app/actions/voice-bank";
import {
  getScheduleConfig,
  saveScheduleConfig,
  type DayKey,
  type SlotRow,
  type ScheduleConfig,
} from "@/app/actions/schedule";
import { SUPPORTED_LANGUAGES, type SupportedLanguage, type LanguageSettings } from "@/lib/types";
import { MODEL_OPTIONS, MODEL_STORAGE_KEY, getStoredModel } from "@/lib/model";
import { getStoredLanguageSettings } from "@/components/settings-sheet";

interface VoiceBankEntry {
  id: string;
  content: string;
  type: "Reply" | "Post";
}

function VoiceBankTab() {
  const [entries, setEntries] = useState<VoiceBankEntry[]>([]);
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<"Reply" | "Post">("Reply");
  const [activeTab, setActiveTab] = useState<"Reply" | "Post">("Reply");

  useEffect(() => {
    getVoiceBankEntries().then(setEntries).catch(() => setEntries([]));
  }, []);

  async function handleAdd() {
    if (!newContent.trim()) return;
    try {
      await addVoiceBankEntry(newContent.trim(), newType === "Reply" ? "REPLY" : "POST");
      const list = await getVoiceBankEntries();
      setEntries(list);
      setNewContent("");
      toast.success("Added to Voice Bank");
    } catch {
      toast.error("Failed to add");
    }
  }

  async function handleDelete(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await removeVoiceBankEntry(id);
    } catch {
      toast.error("Failed to delete");
      getVoiceBankEntries().then(setEntries);
    }
  }

  const filtered = entries.filter((e) => e.type === activeTab);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Textarea
          placeholder="Paste an example of your writing…"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={3}
          className="text-sm"
        />
        <div className="flex items-center gap-2">
          <Select
            value={newType}
            onValueChange={(v) => setNewType(v as "Reply" | "Post")}
          >
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Reply">Reply</SelectItem>
              <SelectItem value="Post">Post</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="gap-2"
            onClick={handleAdd}
            disabled={!newContent.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>

      <Separator />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "Reply" | "Post")}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="Reply">
            Replies ({entries.filter((e) => e.type === "Reply").length})
          </TabsTrigger>
          <TabsTrigger value="Post">
            Posts ({entries.filter((e) => e.type === "Post").length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No {activeTab.toLowerCase()} examples yet
          </p>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className="group relative rounded-lg border border-border bg-muted/40 px-3 py-2.5 transition-colors duration-150"
            >
              <p className="pr-8 text-sm leading-relaxed">{entry.content}</p>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => handleDelete(entry.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

type TimeSegment = "h" | "m" | "period";

interface TimePickerInputProps {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  onDone: () => void;
}

function TimePickerInput({ value, onChange, onDone }: TimePickerInputProps) {
  const [h24, m24] = value.split(":").map(Number);
  const [hour, setHour] = useState(h24 % 12 || 12);
  const [minute, setMinute] = useState(m24);
  const [period, setPeriod] = useState<"am" | "pm">(h24 >= 12 ? "pm" : "am");
  const [segment, setSegment] = useState<TimeSegment>("h");
  const [buffer, setBuffer] = useState("");
  const hourRef = useRef<HTMLSpanElement>(null);
  const minuteRef = useRef<HTMLSpanElement>(null);
  const periodRef = useRef<HTMLSpanElement>(null);

  useEffect(() => { hourRef.current?.focus(); }, []);
  useEffect(() => {
    const refs = { h: hourRef, m: minuteRef, period: periodRef };
    refs[segment].current?.focus();
  }, [segment]);

  function commitValue() {
    const out = hour === 12
      ? (period === "am" ? 0 : 12)
      : (period === "am" ? hour : hour + 12);
    onChange({ target: { value: `${out.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}` } });
  }

  function submit() {
    commitValue();
    onDone();
  }

  function goTo(seg: TimeSegment) { setBuffer(""); setSegment(seg); }

  function handleHourKey(e: React.KeyboardEvent) {
    e.preventDefault();
    if (e.key === "Enter" || e.key === "Tab") { goTo("m"); }
    else if (e.key === "Escape") { onDone(); }
    else if (e.key === "ArrowUp") { setHour(h => h === 12 ? 1 : h + 1); }
    else if (e.key === "ArrowDown") { setHour(h => h === 1 ? 12 : h - 1); }
    else if (/^\d$/.test(e.key)) {
      const d = parseInt(e.key);
      if (buffer === "") {
        if (d === 0) { setBuffer("0"); setHour(12); }
        else if (d >= 2) { setHour(d); goTo("m"); }
        else { setBuffer("1"); setHour(1); }
      } else {
        const h = buffer === "0" ? (d === 0 ? 12 : d) : Math.min(10 + d, 12);
        setHour(h); goTo("m");
      }
    }
  }

  function handleMinuteKey(e: React.KeyboardEvent) {
    e.preventDefault();
    if (e.key === "Enter" || e.key === "Tab") { if (buffer) setMinute(parseInt(buffer)); goTo("period"); }
    else if (e.key === "Escape") { onDone(); }
    else if (e.key === "ArrowUp") { setMinute(m => m === 59 ? 0 : m + 1); }
    else if (e.key === "ArrowDown") { setMinute(m => m === 0 ? 59 : m - 1); }
    else if (/^\d$/.test(e.key)) {
      const d = parseInt(e.key);
      if (buffer === "") {
        if (d >= 6) { setMinute(d); goTo("period"); }
        else { setBuffer(e.key); setMinute(d); }
      } else {
        setMinute(parseInt(buffer) * 10 + d); goTo("period");
      }
    }
  }

  function handlePeriodKey(e: React.KeyboardEvent) {
    e.preventDefault();
    if (e.key === "Enter") { submit(); }
    else if (e.key === "Escape") { onDone(); }
    else if (e.key === "a" || e.key === "A") { setPeriod("am"); }
    else if (e.key === "p" || e.key === "P") { setPeriod("pm"); }
    else if (e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown") {
      setPeriod(p => p === "am" ? "pm" : "am");
    }
  }

  const displayHour = (buffer && segment === "h")
    ? buffer.padStart(2, "0")
    : hour.toString().padStart(2, "0");

  const s = (seg: TimeSegment) =>
    `rounded px-0.5 cursor-default select-none outline-none ${segment === seg ? "bg-blue-500 text-white" : "text-foreground/80 hover:text-foreground"}`;

  return (
    <div
      className="flex items-center text-sm font-mono"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commitValue(); }}
    >
      <span ref={hourRef} tabIndex={0} onKeyDown={handleHourKey} onClick={() => goTo("h")} className={s("h")}>
        {displayHour}
      </span>
      <span className="text-foreground/30">:</span>
      <span ref={minuteRef} tabIndex={0} onKeyDown={handleMinuteKey} onClick={() => goTo("m")} className={s("m")}>
        {minute.toString().padStart(2, "0")}
      </span>
      <span className="mx-1" />
      <span ref={periodRef} tabIndex={0} onKeyDown={handlePeriodKey} onClick={() => goTo("period")} className={s("period")}>
        {period}
      </span>
    </div>
  );
}

const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function emptyDays(): Record<DayKey, boolean> {
  return { Mon: false, Tue: false, Wed: false, Thu: false, Fri: false, Sat: false, Sun: false };
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return time24;
  const period = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  replies: { slots: [] },
  posts: { slots: [] },
  threads: { slots: [] },
  articles: { slots: [] },
};

interface ScheduleSectionProps {
  label: string;
  section: keyof ScheduleConfig;
  slots: SlotRow[];
  onAdd: () => string;
  onRemove: (id: string) => void;
  onTimeChange: (id: string, time: string) => void;
  onDayToggle: (id: string, day: DayKey) => void;
  onAllDaysToggle: (id: string, value: boolean) => void;
  onTimeEditDone: () => void;
}

function ScheduleSection({ label, slots, onAdd, onRemove, onTimeChange, onDayToggle, onAllDaysToggle, onTimeEditDone }: ScheduleSectionProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="grid grid-cols-[110px_repeat(8,1fr)] bg-muted/20 px-1">
          <div className="px-3 py-3 text-xs text-muted-foreground">Time</div>
          <div className="py-3 text-center text-xs font-semibold text-blue-400">All</div>
          {DAYS.map((d) => (
            <div key={d} className="py-3 text-center text-xs font-semibold text-muted-foreground">{d}</div>
          ))}
        </div>

        {slots.map((slot) => {
          const allChecked = DAYS.every((d) => slot.days[d]);
          return (
            <div
              key={slot.id}
              className="grid grid-cols-[110px_repeat(8,1fr)] border-t border-border items-center px-1"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node) && editingId === slot.id) {
                  setEditingId(null);
                  onTimeEditDone();
                }
              }}
            >
              <div className="flex items-center gap-1.5 px-3 py-3">
                {editingId === slot.id ? (
                  <TimePickerInput
                    value={slot.time}
                    onChange={(e) => onTimeChange(slot.id, e.target.value)}
                    onDone={() => { setEditingId(null); onTimeEditDone(); }}
                  />
                ) : (
                  <button
                    onClick={() => setEditingId(slot.id)}
                    className="text-sm text-foreground/80 hover:text-foreground transition-colors"
                  >
                    {formatTime12(slot.time)}
                  </button>
                )}
                <button
                  onClick={() => onRemove(slot.id)}
                  className="text-muted-foreground/50 hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex justify-center py-3">
                <button
                  role="checkbox"
                  aria-checked={allChecked}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onAllDaysToggle(slot.id, !allChecked)}
                  className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all duration-150 ${
                    allChecked
                      ? "bg-blue-500 border-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]"
                      : "border-border/60 bg-muted/30 hover:border-border"
                  }`}
                >
                  {allChecked && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="2,6 5,9 10,3" />
                    </svg>
                  )}
                </button>
              </div>
              {DAYS.map((day) => (
                <div key={day} className="flex justify-center py-3">
                  <button
                    role="checkbox"
                    aria-checked={slot.days[day]}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onDayToggle(slot.id, day)}
                    className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all duration-150 ${
                      slot.days[day]
                        ? "bg-blue-500 border-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]"
                        : "border-border/60 bg-muted/30 hover:border-border"
                    }`}
                  >
                    {slot.days[day] && (
                      <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="2,6 5,9 10,3" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          );
        })}

        <div className="border-t border-border">
          <button
            onClick={() => setEditingId(onAdd())}
            className="flex items-center gap-1.5 px-4 py-3 text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StrategyConfigTab() {
  const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_SCHEDULE);
  const configRef = useRef<ScheduleConfig>(DEFAULT_SCHEDULE);
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getScheduleConfig().then((c) => {
      if (c) {
        const merged = { ...DEFAULT_SCHEDULE, ...c };
        configRef.current = merged;
        setConfig(merged);
      }
    });
  }, []);

  function scheduleSave(newConfig: ScheduleConfig) {
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    pendingSaveRef.current = setTimeout(async () => {
      try {
        await saveScheduleConfig(newConfig);
        window.dispatchEvent(new Event("slots-updated"));
      } catch {
        toast.error("Failed to save strategy");
      }
    }, 300);
  }

  function sortedSlots(slots: SlotRow[]): SlotRow[] {
    return [...slots].sort((a, b) => a.time.localeCompare(b.time));
  }

  function addSlot(section: keyof ScheduleConfig): string {
    const newSlot: SlotRow = { id: crypto.randomUUID(), time: "00:00", days: emptyDays() };
    const newConfig = { ...configRef.current, [section]: { slots: [...configRef.current[section].slots, newSlot] } };
    configRef.current = newConfig;
    setConfig(newConfig);
    return newSlot.id;
  }

  function removeSlot(section: keyof ScheduleConfig, id: string) {
    const newConfig = { ...configRef.current, [section]: { slots: configRef.current[section].slots.filter((s) => s.id !== id) } };
    configRef.current = newConfig;
    setConfig(newConfig);
    scheduleSave(newConfig);
  }

  function updateTime(section: keyof ScheduleConfig, id: string, time: string) {
    const newConfig = {
      ...configRef.current,
      [section]: { slots: configRef.current[section].slots.map((s) => (s.id === id ? { ...s, time } : s)) },
    };
    configRef.current = newConfig;
    setConfig(newConfig);
  }

  function finishTimeEdit(section: keyof ScheduleConfig) {
    const newConfig = {
      ...configRef.current,
      [section]: { slots: sortedSlots(configRef.current[section].slots) },
    };
    configRef.current = newConfig;
    setConfig(newConfig);
    scheduleSave(newConfig);
  }

  function toggleDay(section: keyof ScheduleConfig, id: string, day: DayKey) {
    const newConfig = {
      ...configRef.current,
      [section]: {
        slots: configRef.current[section].slots.map((s) =>
          s.id === id ? { ...s, days: { ...s.days, [day]: !s.days[day] } } : s
        ),
      },
    };
    configRef.current = newConfig;
    setConfig(newConfig);
    scheduleSave(newConfig);
  }

  function toggleAllDays(section: keyof ScheduleConfig, id: string, value: boolean) {
    const allDays: Record<DayKey, boolean> = { Mon: value, Tue: value, Wed: value, Thu: value, Fri: value, Sat: value, Sun: value };
    const newConfig = {
      ...configRef.current,
      [section]: {
        slots: configRef.current[section].slots.map((s) =>
          s.id === id ? { ...s, days: allDays } : s
        ),
      },
    };
    configRef.current = newConfig;
    setConfig(newConfig);
    scheduleSave(newConfig);
  }

  const sections: { label: string; section: keyof ScheduleConfig }[] = [
    { label: "Replies", section: "replies" },
    { label: "Posts", section: "posts" },
    { label: "Threads", section: "threads" },
    { label: "Articles", section: "articles" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {sections.map(({ label, section }) => (
        <ScheduleSection
          key={section}
          label={label}
          section={section}
          slots={config[section].slots}
          onAdd={() => addSlot(section)}
          onRemove={(id) => removeSlot(section, id)}
          onTimeChange={(id, time) => updateTime(section, id, time)}
          onDayToggle={(id, day) => toggleDay(section, id, day)}
          onAllDaysToggle={(id, value) => toggleAllDays(section, id, value)}
          onTimeEditDone={() => finishTimeEdit(section)}
        />
      ))}
    </div>
  );
}

const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = {
  interfaceLanguage: "en",
  conversationLanguage: "ru",
  contentLanguage: "en",
};

function LanguageTab() {
  const [settings, setSettings] = useState<LanguageSettings>(DEFAULT_LANGUAGE_SETTINGS);

  useEffect(() => {
    setSettings(getStoredLanguageSettings());
  }, []);

  function handleChange(key: keyof LanguageSettings, value: SupportedLanguage) {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    const LANGUAGE_STORAGE_KEY = "xreba_language";
    localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(updated));
    toast.success("Language saved");
  }

  const fields: { key: keyof LanguageSettings; label: string; desc: string }[] = [
    { key: "interfaceLanguage",    label: "Interface language",    desc: "UI labels and buttons" },
    { key: "conversationLanguage", label: "Conversation language", desc: "Language AI analyzes and chats in" },
    { key: "contentLanguage",      label: "Content language",      desc: "Language for generated posts and replies" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {fields.map(({ key, label, desc }) => (
        <div key={key} className="flex flex-col gap-2">
          <div>
            <label className="text-sm font-medium">{label}</label>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
          <Select value={settings[key]} onValueChange={(v) => handleChange(key, v as SupportedLanguage)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}

function ApiKeysTab() {
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].value);

  useEffect(() => {
    setModel(getStoredModel());
  }, []);

  function handleModelChange(value: string) {
    setModel(value);
    localStorage.setItem(MODEL_STORAGE_KEY, value);
    toast.success("Model saved");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Model</label>
        <Select value={model} onValueChange={handleModelChange}>
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
  );
}

function AuthTab() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  function handleChange() {
    toast.success("Password changed");
    setCurrentPassword("");
    setNewPassword("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Current password</label>
        <Input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">New password</label>
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      <Button
        size="sm"
        className="w-fit"
        onClick={handleChange}
        disabled={!currentPassword || !newPassword}
      >
        Change password
      </Button>
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="flex flex-col h-full overflow-hidden p-6">
      <h1 className="text-xl font-semibold tracking-[-0.02em] mb-6">Settings</h1>
      <Tabs defaultValue="voice-bank" className="flex flex-col flex-1 min-h-0">
        <TabsList className="grid w-full grid-cols-5 shrink-0">
          <TabsTrigger value="voice-bank" className="text-xs">Voice</TabsTrigger>
          <TabsTrigger value="strategy" className="text-xs">Strategy</TabsTrigger>
          <TabsTrigger value="api-keys" className="text-xs">API</TabsTrigger>
          <TabsTrigger value="language" className="text-xs">Language</TabsTrigger>
          <TabsTrigger value="auth" className="text-xs">Auth</TabsTrigger>
        </TabsList>

        <TabsContent value="voice-bank" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-2xl">
            <VoiceBankTab />
          </div>
        </TabsContent>
        <TabsContent value="strategy" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-2xl">
            <StrategyConfigTab />
          </div>
        </TabsContent>
        <TabsContent value="api-keys" className="mt-4">
          <div className="max-w-2xl">
            <ApiKeysTab />
          </div>
        </TabsContent>
        <TabsContent value="language" className="mt-4">
          <div className="max-w-2xl">
            <LanguageTab />
          </div>
        </TabsContent>
        <TabsContent value="auth" className="mt-4">
          <div className="max-w-2xl">
            <AuthTab />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
