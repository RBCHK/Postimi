import { LeftSidebarContainer } from "@/components/left-sidebar-container";
import { MobileSidebar } from "@/components/mobile-sidebar";
import { AppHeader } from "@/components/app-header";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <MobileSidebar />

      <LeftSidebarContainer />

      <main className="flex flex-1 flex-col overflow-y-auto">
        <AppHeader />
        {children}
      </main>
    </div>
  );
}
