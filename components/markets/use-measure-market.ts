"use client";

/**
 * Measuring a market, as a thing the page does rather than a button.
 *
 * There WAS a button — on the market page, on the markets table, on the
 * map card — and it asked somebody to press "Measure" on a market they
 * had just clicked into. Opening a market IS asking for its figures;
 * the button was the product making the reader say it twice. So the
 * market page runs this on arrival instead, and the tables have no
 * button at all.
 *
 * IT STILL COSTS A CREDIT, AND IT STILL ONLY EVER COSTS ONE. Nothing
 * about the price changed, only who presses the button. Three things
 * keep that honest, and all three are on the server as well:
 *
 *   already on file   free, and checked before the balance is read, so
 *                     a market anybody has measured opens free forever
 *   no room           nothing is bought and nothing is charged; the
 *                     page says so and offers the upgrade
 *   the feed refused  nothing was bought, so nothing is charged
 *
 * A HOOK, NOT AN EFFECT ON A SERVER PAGE. The market page is a server
 * component, and spending there would mean Next's link prefetching —
 * which runs on hover — could buy a market nobody ever opened. This
 * fires from a mounted client component, which prefetch does not do.
 */

import * as React from "react";
import { toast } from "sonner";
import { MARKET_MEASURE_CREDITS } from "@/config/app";
import { useSession } from "@/components/providers/session-provider";

export const MEASURE_PRICE = `${MARKET_MEASURE_CREDITS} ${
  MARKET_MEASURE_CREDITS === 1 ? "credit" : "credits"
}`;

export type MeasureState =
  | { status: "idle" }
  | { status: "measuring" }
  | { status: "done" }
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
 * @param wanted   false when the market already has figures — then this
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
  const { user, creditsRemaining, credits, refreshUsage } = useSession();
  const [state, setState] = React.useState<MeasureState>({ status: "idle" });

  /** One purchase per mount, whatever re-renders or React's own double
   *  invoke in development ask for. */
  const started = React.useRef(false);
  const onDoneRef = React.useRef(onDone);
  React.useEffect(() => {
    onDoneRef.current = onDone;
  });

  const affordable = creditsRemaining + credits >= MARKET_MEASURE_CREDITS;

  const run = React.useCallback(() => {
    if (started.current || !user || !wanted) return;
    if (!affordable) {
      setState({ status: "no-credits" });
      return;
    }
    started.current = true;
    setState({ status: "measuring" });
    void (async () => {
      try {
        const res = await fetch("/api/markets/measure", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ market: slug }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; message?: string; reason?: string; charged?: number }
          | null;
        if (res.status === 402 || data?.reason === "no-credits") {
          setState({ status: "no-credits" });
          return;
        }
        if (!res.ok || !data?.ok) {
          setState({
            status: "failed",
            message: data?.message ?? "Those figures could not be fetched.",
          });
          return;
        }
        setState({ status: "done" });
        const charged = data.charged ?? 0;
        if (charged > 0) {
          toast.success(`${name} measured`, {
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
  }, [affordable, name, refreshUsage, slug, user, wanted]);

  return { state, run };
}
