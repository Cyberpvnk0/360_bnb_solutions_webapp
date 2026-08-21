import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      {/* Page header */}
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />

      {/* Stat header row */}
      <div className="mt-8 flex items-stretch gap-16 overflow-hidden border-y border-border py-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="shrink-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2.5 h-8 w-20" />
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-sm border border-border bg-card">
            <div className="border-b border-border px-6 py-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3.5 w-56 max-w-full" />
            </div>
            <div className="p-6">
              <Skeleton className="h-[268px] w-full" />
            </div>
          </div>
        ))}
      </div>

      {/* Unit economics */}
      <div className="mt-10 rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-3.5 w-48 max-w-full" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between border-b border-border px-6 py-3.5 last:border-0"
          >
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="mt-10 overflow-hidden rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-3.5 w-56 max-w-full" />
        </div>
        <div className="px-2">
          <div className="flex h-9 items-center border-b border-border">
            <Skeleton className="h-3 w-full" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-border py-2.5 last:border-0"
            >
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
