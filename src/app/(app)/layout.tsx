import { LeftSidebarContainer } from "@/components/left-sidebar-container";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <AppHeader />

      <div className="flex flex-1 overflow-hidden md:gap-[15px] md:px-[15px]">
        <LeftSidebarContainer />

        <main className="flex flex-1 flex-col overflow-y-auto md:rounded-[12px] md:bg-sidebar">
          {children}
        </main>
      </div>

      <MobileBottomNav />
      <AppFooter />
    </div>
  );
}
