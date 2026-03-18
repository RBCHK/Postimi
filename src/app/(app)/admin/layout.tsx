import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Redirects to "/" if not admin
  await requireAdmin();

  return <>{children}</>;
}
