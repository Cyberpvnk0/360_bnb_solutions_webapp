import { Skeleton } from "@/components/ui/skeleton";

export default function LandlordsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <Skeleton className="h-8 w-44" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Privacy strip */}
      <div className="mt-5 border-y border-border py-3.5">
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* The book: toolbar header + table, one card */}
      <div className="mt-6 overflow-hidden rounded-sm border border-border bg-card">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
          <Skeleton className="h-9 w-full sm:w-72" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>

        {/* Table */}
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
