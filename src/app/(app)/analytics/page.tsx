import { getAnalyticsDateRange, getAnalyticsSummary } from "@/app/actions/analytics";
import { getGoalChartData } from "@/app/actions/schedule";
import { AnalyticsProvider } from "@/contexts/analytics-context";
import { AnalyticsView } from "./analytics-view";

export default async function AnalyticsPage() {
  const [dateRange, goalChartData] = await Promise.all([
    getAnalyticsDateRange(),
    getGoalChartData(),
  ]);

  let summary = null;
  if (dateRange) {
    summary = await getAnalyticsSummary(dateRange.from, dateRange.to);
  }

  return (
    <AnalyticsProvider
      initialDateRange={dateRange}
      initialSummary={summary}
      initialGoalChartData={goalChartData}
    >
      <AnalyticsView />
    </AnalyticsProvider>
  );
}
