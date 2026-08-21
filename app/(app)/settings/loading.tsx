import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      {/* Page header */}
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />

      {/* Tab bar */}
      <div className="mt-8 flex items-center gap-6 border-b border-border pb-3.5">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-24" />
      </div>

      {/* Tab body */}
      <div className="mt-8 space-y-10">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
