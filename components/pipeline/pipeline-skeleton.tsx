import { PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton for the pipeline board. Used by the route's loading.tsx and by
 * the page itself while the client session hydrates — the header is static
 * copy so nothing shifts when data lands. Columns mirror the board's soft
 * panels; card placeholders sit on them like the real bg-card deal cards.
 */
export function PipelineSkeleton() {
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-8 md:px-10">
        <PageHeader
          title="Pipeline"
          description="Every deal from first call to first guest."
          actions={<Skeleton className="h-5 w-32" />}
        />
      </div>
      <div className="mt-8 px-4 pb-10 md:px-10">
        <div className="overflow-x-auto pb-2">
          <div className="flex items-stretch gap-5">
            {Array.from({ length: 5 }, (_, col) => (
              <div
                key={col}
                className="flex min-w-[284px] flex-1 flex-col rounded-sm border border-border bg-secondary/40 p-3"
              >
                <div className="flex items-center justify-between px-1 pb-4">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-14" />
                </div>
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 3 - (col % 2) }, (_, row) => (
                    <Skeleton
                      key={row}
                      className="h-[154px] w-full border border-border bg-card"
                    />
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
