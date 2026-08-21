import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Deal Finder: chip bar, map pane left, card grid right. */
export default function DealsLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-3.5">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
        <div className="ml-auto flex items-center gap-3">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden min-h-0 w-[55%] shrink-0 border-r border-border lg:block">
          <Skeleton className="h-full w-full rounded-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-lg border border-border"
              >
                <Skeleton className="h-28 w-full rounded-none" />
                <div className="px-5 pb-4 pt-3.5">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="mt-1.5 h-3 w-40" />
                  <Skeleton className="mt-3 h-4 w-36" />
                  <Skeleton className="mt-1.5 h-3 w-28" />
                </div>
                <div className="flex items-center justify-between border-t border-border px-5 py-3">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-8 w-36" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
