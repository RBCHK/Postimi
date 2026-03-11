import { getAnalyticsDateRange, getAnalyticsSummary } from "@/app/actions/analytics";
import { AnalyticsProvider } from "@/contexts/analytics-context";
import { AnalyticsView } from "./analytics-view";

export default async function AnalyticsPage() {
  const dateRange = await getAnalyticsDateRange();

  let summary = null;
  if (dateRange) {
    summary = await getAnalyticsSummary(dateRange.from, dateRange.to);
  }

  return (
    <AnalyticsProvider
      initialDateRange={dateRange}
      initialSummary={summary}
    >
      <AnalyticsView />
    </AnalyticsProvider>
  );
}
