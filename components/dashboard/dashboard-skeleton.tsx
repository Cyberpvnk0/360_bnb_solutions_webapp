import { Skeleton } from "@/components/ui/skeleton";

// Same tracks as the real watched-markets rows so nothing shifts.
const ROW_GRID =
  "grid grid-cols-[minmax(8rem,1.4fr)_minmax(5rem,1fr)_minmax(6rem,1fr)_minmax(4.5rem,0.9fr)] items-center gap-x-4";

/**
 * Skeleton mirror of the dashboard: hero band with the ring circle, the
 * pipeline card with five stage tiles, then the watched-markets and
 * activity cards. Layout classes match DashboardScreen exactly so
 * nothing shifts.
 */
export function DashboardSkeleton() {
  return (
    <div>
      <section className="hero-radial border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-14 md:flex-row md:items-center md:justify-between md:px-10">
          <div className="min-w-0">
            <Skeleton className="h-9 w-44 md:h-10" />
            <Skeleton className="mt-2 h-5 w-72 max-w-full" />
          </div>
          <div className="flex flex-col items-center gap-3 self-center md:self-auto">
            <Skeleton className="size-[150px] rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
        {/* Pipeline card */}
        <div className="overflow-hidden rounded-sm border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-max grid-cols-5 divide-x divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="min-w-[11rem] px-8 py-6">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="mt-2 h-[30px] w-10" />
                  <Skeleton className="mt-1 h-4 w-28" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Watched markets and activity cards */}
        <div className="mt-12 grid grid-cols-1 gap-10 pb-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
          <div className="overflow-hidden rounded-sm border border-border bg-card">
            <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-14" />
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className={`${ROW_GRID} border-b border-border px-6 py-2`}>
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-14" />
                </div>
                <div className="divide-y divide-border">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className={`${ROW_GRID} px-6 py-3.5`}>
                      <div>
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="mt-1 h-3 w-14" />
                      </div>
                      <div>
                        <Skeleton className="h-5 w-12" />
                        <Skeleton className="mt-2 h-4 w-10" />
                      </div>
                      <div>
                        <Skeleton className="h-5 w-10" />
                        <Skeleton className="mt-2 h-4 w-12" />
                      </div>
                      <div>
                        <Skeleton className="h-5 w-12" />
                        <Skeleton className="mt-1 h-3 w-12" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-sm border border-border bg-card">
            <div className="border-b border-border px-6 py-4">
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-3.5">
                  <Skeleton className="size-8 shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16 shrink-0" />
                </div>
              ))}
            </div>
            <div className="border-t border-border px-6 py-3.5">
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
