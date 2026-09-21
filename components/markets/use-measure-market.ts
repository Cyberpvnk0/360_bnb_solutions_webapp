"use client";

/** One automatic bundle request per mounted market. Rendering/prefetching
 * never purchases data. The server checks fresh caches before credit balance
 * and bills only successfully measured sections, at most three credits. */

import * as React from "react";
import { toast } from "sonner";
import { MARKET_MEASURE_CREDITS } from "@/config/app";
import { useSession } from "@/components/providers/session-provider";
import { requestMarketMeasurement, type MarketMeasurement } from "./measure-request";

export const MEASURE_PRICE = `${MARKET_MEASURE_CREDITS} ${
  MARKET_MEASURE_CREDITS === 1 ? "credit" : "credits"
}`;

export type MeasureState =
  | { status: "idle" }
  | { status: "measuring" }
  | ({ status: "done" } & MarketMeasurement)
  | { status: "no-credits" }
  | { status: "failed"; message: string };

export interface MeasureMarket {
  state: MeasureState;
  /** Buy this market's figures. Safe to call again: the first call
   *  latches, so a re-render or a strict-mode double mount cannot
   *  spend twice. */
  run: () => void;
}

/**
 * @param slug     the market to measure
 * @param name     for the toast
 * @param wanted   false when all three sections already have figures — then this
 *                 never fires and never charges
 * @param onDone   after a successful measure; the page refreshes here
 */
export function useMeasureMarket({
  slug,
  name,
  wanted,
  onDone,
}: {
  slug: string;
  name: string;
  wanted: boolean;
  onDone?: () => void;
}): MeasureMarket {
  const { user, refreshUsage } = useSession();
  const [state, setState] = React.useState<MeasureState>({ status: "idle" });

  /** One purchase per mount, whatever re-renders or React's own double
   *  invoke in development ask for. */
  const started = React.useRef(false);
  const onDoneRef = React.useRef(onDone);
  React.useEffect(() => {
    onDoneRef.current = onDone;
  });


  const run = React.useCallback(() => {
    if (started.current || !user || !wanted) return;
    started.current = true;
    setState({ status: "measuring" });
    void (async () => {
      try {
        const result = await requestMarketMeasurement(slug);
        if (result.status === "no-credits") {
          setState({ status: "no-credits" });
          return;
        }
        if (result.status === "failed") {
          setState(result);
          return;
        }
        // The response already contains the bought figures. Show them now;
        // the background route refresh must not be on the display path.
        setState({ status: "done", ...result.measurement });
        const charged = result.charged;
        if (charged > 0) {
          toast.success(result.measurement.errors.length ? `${name} partially measured` : `${name} analyzed`, {
            description: `${charged} ${charged === 1 ? "credit" : "credits"}`,
          });
          void refreshUsage();
        }
        onDoneRef.current?.();
      } catch {
        setState({
          status: "failed",
          message: "Those figures could not be fetched.",
        });
      }
    })();
  }, [name, refreshUsage, slug, user, wanted]);

  return { state, run };
}
