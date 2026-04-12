export const dynamic = "force-dynamic";

import { getCronConfigs, getCronRuns } from "@/app/actions/admin";
import { AdminView } from "./admin-view";

export default async function AdminPage() {
  const [configs, runs] = await Promise.all([getCronConfigs(), getCronRuns({ limit: 50 })]);

  return <AdminView initialConfigs={configs} initialRuns={runs} />;
}
