export const dynamic = "force-dynamic";

import { getAnalyses } from "@/app/actions/strategist";
import { getAllResearchNotes } from "@/app/actions/research";
import { StrategistProvider } from "@/contexts/strategist-context";
import { StrategistView } from "./strategist-view";

export default async function StrategistPage() {
  const [analyses, researchNotes] = await Promise.all([getAnalyses(), getAllResearchNotes()]);

  return (
    <StrategistProvider initialAnalyses={analyses} initialResearchNotes={researchNotes}>
      <StrategistView />
    </StrategistProvider>
  );
}
