import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyzeLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-10">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-1 h-5 w-96 max-w-full" />

      {/* Pull cost notice strip */}
      <Skeleton className="mt-8 h-[52px] w-full" />

      {/* Property card */}
      <div className="mt-6 rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-12 w-full" />
          <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_1fr_1.2fr]">
            <div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-[38px] w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-[38px] w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-[38px] w-full" />
            </div>
          </div>
          <Skeleton className="mt-8 h-10 w-full sm:w-44" />
          <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        </div>
      </div>

      {/* Recent pulls card */}
      <div className="mb-12 mt-12 overflow-hidden rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 px-6 py-2.5"
            >
              <Skeleton className="h-5 w-56 max-w-full" />
              <Skeleton className="h-[21px] w-24 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
