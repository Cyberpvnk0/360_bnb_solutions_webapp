import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton split view mirroring the explorer so nothing shifts. */
export default function MarketsLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
        <div className="ml-auto flex items-center gap-3 pl-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>

      {/* Mobile pane toggle */}
      <div className="flex shrink-0 border-b border-border lg:hidden">
        <div className="flex flex-1 items-center justify-center py-2">
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="flex flex-1 items-center justify-center py-2">
          <Skeleton className="h-5 w-16" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Map pane */}
        <div className="flex min-h-0 w-full flex-col lg:w-[60%] lg:border-r lg:border-border">
          <Skeleton className="min-h-0 flex-1 rounded-none" />
          <div className="flex shrink-0 items-center gap-4 border-t border-border px-5 py-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>

        {/* List pane */}
        <div className="hidden min-h-0 flex-col overflow-hidden lg:flex lg:w-[40%]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border-b border-border px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <div className="mt-3 grid grid-cols-5 gap-x-4 gap-y-2 pl-8">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j}>
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="mt-1 h-4 w-14" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
