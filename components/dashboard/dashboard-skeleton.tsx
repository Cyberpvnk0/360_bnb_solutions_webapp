import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton mirror of the dashboard: hero band with the ring circle,
 * five stage tiles, then the watched-markets and activity columns.
 * Layout classes match DashboardScreen exactly so nothing shifts.
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
        {/* Pipeline tiles */}
        <Skeleton className="h-4 w-16" />
        <div className="mt-3 grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[122px]" />
          ))}
        </div>

        {/* Watched markets and activity columns */}
        <div className="mt-12 grid grid-cols-1 gap-10 pb-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <div className="flex items-baseline justify-between gap-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-14" />
            </div>
            <Skeleton className="mt-3 h-8 w-full" />
            <div className="mt-px space-y-px">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] w-full" />
              ))}
            </div>
          </div>
          <div>
            <Skeleton className="h-4 w-28" />
            <div className="mt-3 space-y-px">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[60px] w-full" />
              ))}
            </div>
            <Skeleton className="mt-3 h-4 w-40" />
          </div>
        </div>
      </div>
    </div>
  );
}
