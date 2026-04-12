"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import type { BillingInfo } from "@/app/actions/billing";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Past due",
  CANCELED: "Canceled",
  INCOMPLETE: "Incomplete",
  INCOMPLETE_EXPIRED: "Expired",
  UNPAID: "Unpaid",
};

function StatusBadge({ status }: { status: string }) {
  const isGood = status === "ACTIVE" || status === "TRIALING";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
        isGood
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function BillingView({ billing }: { billing: BillingInfo }) {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<"checkout" | "portal" | null>(null);

  // Show toast for checkout result (from Stripe redirect)
  const checkoutResult = searchParams.get("checkout");
  if (checkoutResult === "success") {
    // Only show once by checking if it hasn't been dismissed
    toast.success("Subscription activated! Welcome to Postimi Pro.", { id: "checkout-success" });
  }

  async function handleCheckout() {
    setLoading("checkout");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error("Failed to start checkout. Please try again.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  async function handlePortal() {
    setLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error("Failed to open billing portal. Please try again.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  const isActive = billing.status === "ACTIVE" || billing.status === "TRIALING";

  return (
    <PageContainer className="space-y-6">
      <PageHeader title="Billing" />

      <div className="max-w-lg space-y-6">
        {/* Current plan */}
        <div className="rounded-lg border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Current plan</h3>
            {billing.status && <StatusBadge status={billing.status} />}
          </div>

          {billing.hasSubscription ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Postimi Pro
                {billing.cancelAtPeriodEnd && (
                  <span className="ml-1 text-yellow-600 dark:text-yellow-400">
                    (cancels at period end)
                  </span>
                )}
              </p>
              {billing.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground">
                  {billing.cancelAtPeriodEnd ? "Access until" : "Renews"}{" "}
                  {new Date(billing.currentPeriodEnd).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active subscription. Subscribe to unlock AI features.
            </p>
          )}
        </div>

        {/* Action */}
        {isActive ? (
          <Button variant="outline" onClick={handlePortal} disabled={loading !== null}>
            {loading === "portal" ? "Opening..." : "Manage billing"}
          </Button>
        ) : (
          <Button onClick={handleCheckout} disabled={loading !== null}>
            {loading === "checkout" ? "Redirecting..." : "Subscribe to Postimi Pro"}
          </Button>
        )}
      </div>
    </PageContainer>
  );
}
