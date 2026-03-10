"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { CsvSummary, StrategyAnalysisItem } from "@/lib/types";

export async function saveAnalysis(data: {
  csvSummary: CsvSummary;
  searchQueries: string[];
  recommendation: string;
  weekStart: Date;
}): Promise<StrategyAnalysisItem> {
  const row = await prisma.strategyAnalysis.create({
    data: {
      csvSummary: data.csvSummary as object,
      searchQueries: data.searchQueries,
      recommendation: data.recommendation,
      weekStart: data.weekStart,
    },
  });

  revalidatePath("/strategist");

  return {
    id: row.id,
    weekStart: row.weekStart,
    recommendation: row.recommendation,
    createdAt: row.createdAt,
    csvSummary: row.csvSummary as unknown as CsvSummary,
    searchQueries: row.searchQueries,
  };
}

export async function getAnalyses(): Promise<StrategyAnalysisItem[]> {
  const rows = await prisma.strategyAnalysis.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      weekStart: true,
      recommendation: true,
      createdAt: true,
      csvSummary: true,
      searchQueries: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    weekStart: r.weekStart,
    recommendation: r.recommendation,
    createdAt: r.createdAt,
    csvSummary: r.csvSummary as unknown as CsvSummary,
    searchQueries: r.searchQueries,
  }));
}

export async function getAnalysis(id: string): Promise<StrategyAnalysisItem | null> {
  const row = await prisma.strategyAnalysis.findUnique({ where: { id } });
  if (!row) return null;

  return {
    id: row.id,
    weekStart: row.weekStart,
    recommendation: row.recommendation,
    createdAt: row.createdAt,
    csvSummary: row.csvSummary as unknown as CsvSummary,
    searchQueries: row.searchQueries,
  };
}

export async function deleteAnalysis(id: string): Promise<void> {
  await prisma.strategyAnalysis.delete({ where: { id } });
  revalidatePath("/strategist");
}
