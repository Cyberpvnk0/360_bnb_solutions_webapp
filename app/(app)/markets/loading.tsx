import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the explorer: chip bar, card grid left, map pane right. */
export default function MarketsLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-3.5">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
        <div className="ml-auto flex items-center gap-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-sm border border-border">
                <Skeleton className="h-24 w-full rounded-none" />
                <div className="px-5 pb-3 pt-7">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="mt-1.5 h-3 w-28" />
                </div>
                <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="px-4 py-3">
                      <Skeleton className="h-5 w-14" />
                      <Skeleton className="mt-1 h-2.5 w-16" />
                    </div>
                  ))}
                </div>
                <div className="border-t border-border px-5 py-2">
                  <Skeleton className="h-3 w-44" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden min-h-0 w-[42%] shrink-0 border-l border-border lg:block">
          <Skeleton className="h-full w-full rounded-none" />
        </div>
      </div>
    </div>
  );
}
