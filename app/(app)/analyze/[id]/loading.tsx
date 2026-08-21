import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the analysis layout exactly so nothing shifts when data lands. */
export default function AnalyzeResultLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-52" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>

      <div className="mt-8 overflow-hidden border-y border-border">
        <div className="flex min-w-max items-stretch divide-x divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-8 py-6 first:pl-0">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-8 w-32" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center border-y border-border py-14">
        <Skeleton className="size-[300px] rounded-full" />
        <Skeleton className="mt-6 h-5 w-44 rounded-full" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Skeleton className="h-[560px]" />
        <Skeleton className="h-[560px]" />
      </div>

      <div className="mt-14 space-y-14 pb-14">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
