import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the market detail layout so nothing shifts when data lands. */
export default function MarketDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <Skeleton className="h-4 w-24" />

      {/* Header */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-64" />
        </div>
      </div>

      {/* Stat band */}
      <div className="mt-8 overflow-hidden border-y border-border">
        <div className="flex items-stretch divide-x divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-1 px-8 py-6 first:pl-0 last:pr-0">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-8 w-20" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="mt-8 space-y-8">
        <Skeleton className="h-[374px] w-full" />
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="h-[354px]" />
          <Skeleton className="h-[354px]" />
        </div>
      </div>

      {/* Regulation + pencils strip */}
      <div className="mt-8 grid gap-8 pb-10 lg:grid-cols-2">
        <Skeleton className="h-[13.5rem]" />
        <Skeleton className="h-[13.5rem]" />
      </div>
    </div>
  );
}
