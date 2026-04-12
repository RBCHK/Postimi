export const dynamic = "force-dynamic";

import { getLatestDailyInsight } from "@/app/actions/daily-insight";
import { getGoalConfig, getGoalTrackingData } from "@/app/actions/schedule";
import { getPendingProposal } from "@/app/actions/plan-proposal";
import { HomeView } from "./home-view";

export default async function HomePage() {
  const [insight, goalData, goalConfig, pendingProposal] = await Promise.all([
    getLatestDailyInsight(),
    getGoalTrackingData(),
    getGoalConfig(),
    getPendingProposal(),
  ]);

  return (
    <HomeView
      insights={insight?.insights ?? null}
      insightDate={insight?.date.toISOString().split("T")[0] ?? null}
      goalData={goalData}
      hasGoalConfig={!!(goalConfig?.targetFollowers && goalConfig?.targetDate)}
      pendingProposal={pendingProposal}
    />
  );
}
