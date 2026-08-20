import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the analysis layout exactly so nothing shifts when data lands. */
export default function AnalyzeResultLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
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

      <div className="mt-6 flex flex-col items-center border-y border-border py-8">
        <Skeleton className="size-[280px] rounded-full" />
        <Skeleton className="mt-4 h-5 w-44 rounded-full" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Skeleton className="h-[560px]" />
        <Skeleton className="h-[560px]" />
      </div>

      <div className="mt-10 space-y-10 pb-10">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
