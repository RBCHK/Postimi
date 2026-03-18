import { LeftSidebarContainer } from "@/components/left-sidebar-container";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";
import { isAdmin } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const showAdmin = await isAdmin();

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader />

      <div className="flex flex-1 overflow-hidden md:px-[15px]">
        <LeftSidebarContainer showAdmin={showAdmin} />

        <main className="flex flex-1 flex-col overflow-y-auto md:rounded-[12px] md:bg-sidebar pb-[calc(54px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>

      <MobileBottomNav />
      <AppFooter />
    </div>
  );
}
