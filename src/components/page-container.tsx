import { cn } from "@/lib/utils";

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex-1 p-4 md:rounded-[12px] md:bg-sidebar", className)}>{children}</div>
  );
}
