import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the analysis layout exactly so nothing shifts when data lands. */
export default function AnalyzeResultLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      {/* Hero card */}
      <div className="overflow-hidden rounded-sm border border-border bg-card">
        <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
          <Skeleton className="h-28 w-full max-w-44 shrink-0 md:h-[104px] md:w-[152px]" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-8 w-72 max-w-full" />
            <Skeleton className="h-4 w-52" />
            <div className="flex gap-1.5 pt-1">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>
        <div className="overflow-hidden border-t border-border">
          <div className="flex min-w-max items-stretch divide-x divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-6 py-5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-2 h-8 w-28" />
                <Skeleton className="mt-1.5 h-3 w-36" />
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border px-6 py-5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-[88px] w-full" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
      </div>

      {/* Calculator + projection */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>

      {/* Comps explorer + lease evidence */}
      <div className="mt-14 space-y-14 pb-14">
        <div>
          <Skeleton className="h-12 w-full" />
          <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Skeleton className="h-96" />
            <Skeleton className="aspect-square w-full" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
