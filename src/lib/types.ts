export const CONTENT_TYPES = ["Reply", "Post", "Thread", "Article"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const DRAFT_STATUSES = ["draft", "packaged", "scheduled", "posted"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const SLOT_STATUSES = ["empty", "filled", "posted"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const SLOT_TYPES = ["Reply", "Post", "Thread", "Article"] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export interface Draft {
  id: string;
  title: string;
  contentType: ContentType;
  status: DraftStatus;
  pinned: boolean;
  updatedAt: Date;
}

export interface ScheduledSlot {
  id: string;
  date: Date;
  timeSlot: string;
  slotType: SlotType;
  status: SlotStatus;
  draftId?: string;
  draftTitle?: string;
  postedAt?: Date;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export interface Note {
  id: string;
  content: string;
  createdAt: Date;
}

export const SUPPORTED_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ru", label: "Russian" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["value"];

export interface LanguageSettings {
  interfaceLanguage: SupportedLanguage;
  conversationLanguage: SupportedLanguage;
  contentLanguage: SupportedLanguage;
}

export interface CsvRow {
  postId: string;
  date: string;
  text: string;
  impressions: number;
  likes: number;
  engagements: number;
  bookmarks: number;
  shares: number;
  newFollows: number;
  replies: number;
  reposts: number;
}

export interface CsvTopPost {
  text: string;
  impressions: number;
  engagements: number;
  likes: number;
}

export interface CsvSummary {
  totalPosts: number;
  dateRange: { from: string; to: string };
  avgImpressions: number;
  maxImpressions: number;
  totalNewFollows: number;
  avgEngagementRate: number;
  topPosts: CsvTopPost[];
}

export interface StrategyAnalysisItem {
  id: string;
  weekStart: Date;
  recommendation: string;
  createdAt: Date;
  csvSummary: CsvSummary;
  searchQueries: string[];
}
