import Link from "next/link";
import { FolderPlus } from "lucide-react";
import { PIPELINE_STAGES, type Deal } from "@/lib/mock/types";
import { fmtMoney } from "@/lib/format";
import { AnimatedNumber } from "@/components/primitives/animated-number";
import { EmptyState } from "@/components/primitives/empty-state";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Five stage tiles in a hairline-divided row: deal count and summed
 * projected monthly cash flow per stage. Every tile opens the pipeline.
 */
export function PipelineSummary({ deals }: { deals: Deal[] }) {
  if (deals.length === 0) {
    return (
      <section aria-labelledby="pipeline-title">
        <MetricLabel id="pipeline-title">Pipeline</MetricLabel>
        <EmptyState
          className="mt-3"
          icon={FolderPlus}
          title="Save your first deal"
          description="Analyses you save land here, staged from first look to live listing."
          action={
            <Button asChild variant="outline">
              <Link href="/analyze">Analyze an address</Link>
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="pipeline-title">
      <MetricLabel id="pipeline-title">Pipeline</MetricLabel>
      <div className="mt-3 overflow-x-auto">
        <div className="grid min-w-max grid-cols-5 divide-x divide-border border-y border-border">
          {PIPELINE_STAGES.map(({ id, label }) => {
            const staged = deals.filter((d) => d.stage === id);
            const cash = staged.reduce((sum, d) => sum + d.netCashFlow, 0);
            return (
              <Link
                key={id}
                href="/pipeline"
                className="min-w-[11rem] px-8 py-6 transition-colors duration-150 hover:bg-secondary/40"
              >
                <MetricLabel>{label}</MetricLabel>
                <div className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-foreground tabular">
                  <AnimatedNumber value={staged.length} />
                </div>
                <div className="mt-1 text-xs tabular">
                  <span
                    className={cn(
                      cash > 0 ? "text-gold" : "text-muted-foreground"
                    )}
                  >
                    {fmtMoney(cash)}
                  </span>
                  <span className="text-muted-foreground"> /mo projected</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
