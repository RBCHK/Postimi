import { getLatestDailyInsight } from "@/app/actions/daily-insight";
import { HomeView } from "./home-view";

export default async function HomePage() {
  const insight = await getLatestDailyInsight();

  return (
    <HomeView
      insights={insight?.insights ?? null}
      insightDate={insight?.date.toISOString().split("T")[0] ?? null}
    />
  );
}
