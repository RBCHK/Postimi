import { getAnalyses } from "@/app/actions/strategist";
import { StrategistProvider } from "@/contexts/strategist-context";
import { StrategistView } from "./strategist-view";

export default async function StrategistPage() {
  const analyses = await getAnalyses();

  return (
    <StrategistProvider initialAnalyses={analyses}>
      <StrategistView />
    </StrategistProvider>
  );
}
