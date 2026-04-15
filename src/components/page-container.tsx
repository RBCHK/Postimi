import { cn } from "@/lib/utils";

type Width = "narrow" | "full";

export function PageContainer({
  children,
  className,
  width = "narrow",
}: {
  children: React.ReactNode;
  className?: string;
  width?: Width;
}) {
  const inner = width === "narrow" ? "mx-auto w-full max-w-3xl" : "w-full";
  return (
    <div className={cn("flex-1 p-4 md:rounded-[12px] md:bg-sidebar", className)}>
      <div className={cn("flex flex-col h-full", inner)}>{children}</div>
    </div>
  );
}
