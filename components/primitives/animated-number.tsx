"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps extends React.ComponentProps<"span"> {
  value: number;
  /** Formatter applied to the interpolated value each frame. */
  format?: (n: number) => string;
  durationMs?: number;
}

/**
 * A figure that counts up (or down) to its new value in ~200ms.
 * Renders the final value on the server; only changes animate.
 * Respects prefers-reduced-motion.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  durationMs = 200,
  className,
  ...props
}: AnimatedNumberProps) {
  const [display, setDisplay] = React.useState(value);
  const fromRef = React.useRef(value);
  const frameRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const from = fromRef.current;
    if (from === value || !Number.isFinite(value) || !Number.isFinite(from)) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) * (1 - t); // ease-out
      setDisplay(from + (value - from) * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return (
    <span className={cn("tabular", className)} {...props}>
      {format(display)}
    </span>
  );
}
