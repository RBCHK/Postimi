export const dynamic = "force-dynamic";

import { getLatestDailyInsight } from "@/app/actions/daily-insight";
import { getPendingProposal } from "@/app/actions/plan-proposal";
import { HomeView } from "./home-view";

export default async function HomePage() {
  const [insight, pendingProposal] = await Promise.all([
    getLatestDailyInsight(),
    getPendingProposal(),
  ]);

  return (
    <HomeView
      insights={insight?.insights ?? null}
      insightDate={insight?.date.toISOString().split("T")[0] ?? null}
      pendingProposal={pendingProposal}
    />
  );
}
