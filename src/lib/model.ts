export const MODEL_OPTIONS = [
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", shortLabel: "Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", shortLabel: "Haiku 4.5" },
] as const;

export type ModelValue = (typeof MODEL_OPTIONS)[number]["value"];

// Legacy key — used for the Analyst (chat) agent
export const MODEL_STORAGE_KEY = "postimi_model";

export const AGENT_MODEL_KEYS = {
  analyst: "postimi_model",
  strategist: "postimi_model_strategist",
  researcher: "postimi_model_researcher",
  dailyInsight: "postimi_model_daily_insight",
} as const;

export type AgentKey = keyof typeof AGENT_MODEL_KEYS;

export function getStoredModel(): string {
  if (typeof window === "undefined") return MODEL_OPTIONS[0].value;
  return localStorage.getItem(MODEL_STORAGE_KEY) ?? MODEL_OPTIONS[0].value;
}

export function setStoredModel(value: string): void {
  localStorage.setItem(MODEL_STORAGE_KEY, value);
}

export function getStoredAgentModel(agent: AgentKey): string {
  if (typeof window === "undefined") return MODEL_OPTIONS[0].value;
  return localStorage.getItem(AGENT_MODEL_KEYS[agent]) ?? MODEL_OPTIONS[0].value;
}

export function setStoredAgentModel(agent: AgentKey, value: string): void {
  localStorage.setItem(AGENT_MODEL_KEYS[agent], value);
}
