import { prisma } from "@/lib/prisma";
import type { Language } from "@/generated/prisma";

// ADR-008 Phase 5: user-scoped profile settings.
//
// `outputLanguage` is typed as the Prisma enum. Any payload that isn't
// one of the enum values is rejected at the DB layer — the guard below
// mirrors that check so we fail fast without a round-trip.

export const VALID_LANGUAGES: readonly Language[] = ["EN", "RU", "UK", "ES", "DE", "FR"];

export async function updateOutputLanguage(userId: string, lang: Language): Promise<void> {
  if (!VALID_LANGUAGES.includes(lang)) {
    throw new Error(`Invalid language: ${typeof lang === "string" ? lang.slice(0, 20) : "?"}`);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { outputLanguage: lang },
  });
}

export async function getOutputLanguage(userId: string): Promise<Language | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { outputLanguage: true },
  });
  return user?.outputLanguage ?? null;
}
