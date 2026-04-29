"use server";

import { requireUserId } from "@/lib/auth";
import type { Language } from "@/generated/prisma";
import {
  updateOutputLanguage as _updateOutputLanguage,
  getOutputLanguage as _getOutputLanguage,
  getUserNiche as _getUserNiche,
  setUserNiche as _setUserNiche,
} from "@/lib/server/user-settings";

export async function updateOutputLanguage(lang: Language): Promise<void> {
  const userId = await requireUserId();
  return _updateOutputLanguage(userId, lang);
}

export async function getOutputLanguage(): Promise<Language | null> {
  const userId = await requireUserId();
  return _getOutputLanguage(userId);
}

export async function getUserNiche(): Promise<string | null> {
  const userId = await requireUserId();
  return _getUserNiche(userId);
}

export async function setUserNiche(niche: string | null): Promise<void> {
  const userId = await requireUserId();
  return _setUserNiche(userId, niche);
}
