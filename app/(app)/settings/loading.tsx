import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      {/* Page header */}
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />

      {/* Tab bar */}
      <div className="mt-6 flex items-center gap-6 border-b border-border pb-3.5">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-24" />
      </div>

      {/* Tab body */}
      <div className="mt-6 space-y-6">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
