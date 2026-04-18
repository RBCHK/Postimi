export const dynamic = "force-dynamic";

import { getAnalyticsDateRange, getAnalyticsSummary } from "@/app/actions/analytics";
import { getConnectedPlatforms } from "@/app/actions/platforms";
import { AnalyticsProvider } from "@/contexts/analytics-context";
import { AnalyticsView } from "./analytics-view";

export default async function AnalyticsPage() {
  const [dateRange, connected] = await Promise.all([
    getAnalyticsDateRange(),
    getConnectedPlatforms(),
  ]);

  let summary = null;
  if (dateRange) {
    summary = await getAnalyticsSummary(dateRange.from, dateRange.to);
  }

  const selectedPlatform = connected.primary ?? connected.platforms[0] ?? "X";

  return (
    <AnalyticsProvider
      initialDateRange={dateRange}
      initialSummary={summary}
      initialConnectedPlatforms={connected.platforms}
      initialSelectedPlatform={selectedPlatform}
    >
      <AnalyticsView />
    </AnalyticsProvider>
  );
}
