import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyzeLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <Skeleton className="mt-6 h-12 w-full" />
      <Skeleton className="mt-6 h-3 w-32" />
      <Skeleton className="mt-2 h-12 w-full" />
      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
      <Skeleton className="mt-8 h-11 w-44" />
    </div>
  );
}
