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
      <div className="mt-8 space-y-8">
        <div className="rounded-sm border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="p-6">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="mt-2 h-4 w-64 max-w-full" />
          </div>
        </div>
        <div className="rounded-sm border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="p-6">
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="mt-3 h-3 w-56 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  );
}
