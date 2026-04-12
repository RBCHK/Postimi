import { SettingsView } from "./settings-view";

export const dynamic = "force-dynamic";
// Allow after() background work (agent crons) to run up to 120s
export const maxDuration = 120;

export default function SettingsPage() {
  return <SettingsView />;
}
