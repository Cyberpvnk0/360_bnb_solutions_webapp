import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      {/* Page header */}
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />

      {/* Stat header row */}
      <div className="mt-8 flex items-stretch gap-16 overflow-hidden border-y border-border py-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="shrink-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2.5 h-8 w-20" />
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>

      {/* Unit economics + users table */}
      <Skeleton className="mt-10 h-56 w-full" />
      <Skeleton className="mt-10 h-96 w-full" />
    </div>
  );
}
