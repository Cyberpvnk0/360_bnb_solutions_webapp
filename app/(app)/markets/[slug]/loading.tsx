import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the market detail layout so nothing shifts when data lands. */
export default function MarketDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <Skeleton className="h-4 w-24" />

      {/* Hero card */}
      <div className="mt-4 overflow-hidden rounded-sm border border-border bg-card">
        {/* Banner + margin badge + watch toggle */}
        <div className="relative">
          <Skeleton className="h-28 w-full rounded-none" />
          <Skeleton className="absolute right-4 top-4 h-8 w-32" />
          <Skeleton className="absolute -bottom-6 left-6 size-14 rounded-full" />
        </div>

        {/* Identity + primary CTA */}
        <div className="flex flex-col gap-4 p-6 pt-8 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-64" />
        </div>

        {/* Headline figures */}
        <div className="overflow-hidden border-t border-border">
          <div className="flex items-stretch divide-x divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-1 px-6 py-5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="mt-2 h-8 w-20" />
                <Skeleton className="mt-2 h-3.5 w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="mt-8 space-y-8">
        <Skeleton className="h-[387px] w-full" />
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="h-[367px]" />
          <Skeleton className="h-[367px]" />
        </div>
      </div>

      {/* Submarkets table */}
      <div className="mt-8 overflow-hidden rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
        <div className="px-6 py-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="my-3 h-3.5 w-full" />
          ))}
        </div>
      </div>

      {/* Pencils card */}
      <div className="mt-8 pb-10">
        <div className="rounded-sm border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-2 h-3 w-64" />
          </div>
          <div className="p-6">
            <Skeleton className="h-[4.5rem] w-full" />
            <Skeleton className="mt-3 h-4 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}
