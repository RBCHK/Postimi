import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { LeftSidebarContainer } from "@/components/left-sidebar-container";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";
import { ClerkProviderWrapper } from "@/components/clerk-provider-wrapper";
import { isAdmin, isAdminClerkId } from "@/lib/auth";
import { getActiveSubscription } from "@/lib/subscription";
import { prisma } from "@/lib/prisma";
import { TimezoneSync } from "@/components/timezone-sync";

async function enforceBillingGate(): Promise<void> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return;
  if (isAdminClerkId(clerkId)) return;

  const pathname = (await headers()).get("x-pathname") ?? "";
  // Allowlist: billing page itself (where users go to pay) + sign-up (new users haven't synced yet).
  if (pathname.startsWith("/settings/billing") || pathname.startsWith("/sign-up")) return;

  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) return;

  const sub = await getActiveSubscription(user.id);
  if (sub) return;

  redirect("/settings/billing");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await enforceBillingGate();
  const showAdmin = await isAdmin();

  return (
    <ClerkProviderWrapper>
      <div data-app-shell className="flex h-dvh flex-col bg-background">
        <AppHeader />

        <div className="flex flex-1 overflow-hidden md:px-[15px]">
          <LeftSidebarContainer showAdmin={showAdmin} />

          <main className="flex flex-1 flex-col overflow-y-auto pb-[calc(54px+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </div>

        <MobileBottomNav />
        <AppFooter />
        <TimezoneSync />
      </div>
    </ClerkProviderWrapper>
  );
}
