"use server";

import { requireUserId } from "@/lib/auth";
import type { Language } from "@/generated/prisma";
import {
  updateOutputLanguage as _updateOutputLanguage,
  getOutputLanguage as _getOutputLanguage,
} from "@/lib/server/user-settings";

export async function updateOutputLanguage(lang: Language): Promise<void> {
  const userId = await requireUserId();
  return _updateOutputLanguage(userId, lang);
}

export async function getOutputLanguage(): Promise<Language | null> {
  const userId = await requireUserId();
  return _getOutputLanguage(userId);
}
