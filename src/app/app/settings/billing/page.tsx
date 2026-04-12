export const dynamic = "force-dynamic";

import { getBillingInfo } from "@/app/actions/billing";
import { BillingView } from "./billing-view";

export default async function BillingPage() {
  const billing = await getBillingInfo();
  return <BillingView billing={billing} />;
}
