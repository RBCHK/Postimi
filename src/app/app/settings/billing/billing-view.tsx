"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Current plan</CardTitle>
              {billing.status && <StatusBadge status={billing.status} />}
            </div>
          </CardHeader>
          <CardContent className="px-4">
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
          </CardContent>
        </Card>

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

      <UsageSection billing={billing} />
    </PageContainer>
  );
}

function UsageSection({ billing }: { billing: BillingInfo }) {
  const pct = billing.quotaUsd > 0 ? Math.min(100, (billing.usedUsd / billing.quotaUsd) * 100) : 0;
  const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">AI usage this period</CardTitle>
            <span className="text-sm tabular-nums text-muted-foreground">
              ${billing.usedUsd.toFixed(2)} / ${billing.quotaUsd.toFixed(2)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-4 space-y-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>

          {billing.breakdown.length > 0 && (
            <div className="space-y-1 pt-2">
              {billing.breakdown.map((b) => (
                <div
                  key={b.operation}
                  className="flex items-center justify-between text-xs text-muted-foreground"
                >
                  <span>
                    {b.operation} <span className="opacity-60">({b.count})</span>
                  </span>
                  <span className="tabular-nums">${b.costUsd.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {billing.recent.length > 0 && (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Recent activity (last 30 days)</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="space-y-1 text-xs">
              {billing.recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border-b border-border/50 py-1.5 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.operation}</span>
                    <span className="opacity-60">{r.model}</span>
                    {r.status !== "COMPLETED" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase">
                        {r.status.toLowerCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span className="tabular-nums">
                      {r.tokensIn + r.tokensOut > 0
                        ? `${(r.tokensIn + r.tokensOut).toLocaleString()}t`
                        : "—"}
                    </span>
                    <span className="tabular-nums">${r.costUsd.toFixed(4)}</span>
                    <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
