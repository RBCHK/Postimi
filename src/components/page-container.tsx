import { cn } from "@/lib/utils";

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-5xl p-4 md:rounded-[12px] md:bg-sidebar", className)}>
      {children}
    </div>
  );
}
