import { PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton for the pipeline board. Used by the route's loading.tsx and by
 * the page itself while the client session hydrates — the header is static
 * copy so nothing shifts when data lands.
 */
export function PipelineSkeleton() {
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-6 md:px-8">
        <PageHeader
          title="Pipeline"
          description="Every deal from first call to first guest."
          actions={<Skeleton className="h-5 w-32" />}
        />
      </div>
      <div className="mt-6 px-4 pb-10 md:px-8">
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3">
            {Array.from({ length: 5 }, (_, col) => (
              <div key={col} className="min-w-[270px] flex-1 p-2">
                <div className="flex items-center justify-between px-1 pb-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-14" />
                </div>
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 3 - (col % 2) }, (_, row) => (
                    <Skeleton key={row} className="h-[124px] w-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
