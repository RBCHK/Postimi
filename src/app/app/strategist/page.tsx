export const dynamic = "force-dynamic";

import { getAnalyses } from "@/app/actions/strategist";
import { getAllUserResearchNotes } from "@/app/actions/research";
import { getConnectedPlatforms } from "@/app/actions/platforms";
import { StrategistProvider } from "@/contexts/strategist-context";
import { StrategistView } from "./strategist-view";

export default async function StrategistPage() {
  const [analyses, researchNotes, connected] = await Promise.all([
    getAnalyses(),
    getAllUserResearchNotes(),
    getConnectedPlatforms(),
  ]);

  // A user with zero connected platforms still lands on the Strategist
  // tab — give them an X placeholder so the page renders. The empty
  // state handles "connect a platform first" messaging.
  const platforms = connected.platforms.length > 0 ? connected.platforms : ["X" as const];
  const primary = connected.primary ?? platforms[0] ?? "X";

  return (
    <StrategistProvider
      initialAnalyses={analyses}
      initialResearchNotes={researchNotes}
      connectedPlatforms={platforms}
      primaryPlatform={primary}
    >
      <StrategistView />
    </StrategistProvider>
  );
}
