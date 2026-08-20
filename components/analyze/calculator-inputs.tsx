"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import type { DealInputs } from "@/lib/calc/arbitrage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MetricLabel } from "@/components/primitives/metric-label";
import { cn } from "@/lib/utils";

interface FieldSpec {
  key: keyof DealInputs;
  label: string;
  prefix?: string;
  suffix?: string;
  step?: number;
  /** Multiply displayed value by 100 (percent fields stored as fractions). */
  percent?: boolean;
  hint?: string;
}

const GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Lease",
    fields: [
      { key: "monthlyRent", label: "Monthly lease rent", prefix: "$", step: 25 },
      { key: "securityDeposit", label: "Security deposit", prefix: "$", step: 100 },
    ],
  },
  {
    title: "Setup",
    fields: [
      { key: "furnishingBudget", label: "Furnishing budget", prefix: "$", step: 250 },
    ],
  },
  {
    title: "Monthly operating",
    fields: [
      { key: "utilitiesMonthly", label: "Utilities", prefix: "$", step: 10 },
      { key: "internetMonthly", label: "Internet", prefix: "$", step: 5 },
      { key: "suppliesMonthly", label: "Supplies", prefix: "$", step: 5 },
      { key: "insuranceMonthly", label: "Insurance", prefix: "$", step: 5 },
    ],
  },
  {
    title: "Turnovers",
    fields: [
      {
        key: "cleaningCostPerTurnover",
        label: "Cleaning cost per turnover",
        prefix: "$",
        step: 5,
        hint: "Guests are charged the same amount as a cleaning fee.",
      },
      {
        key: "avgStayNights",
        label: "Average stay length",
        suffix: "nights",
        step: 0.1,
      },
    ],
  },
  {
    title: "Fees",
    fields: [
      {
        key: "platformFeePct",
        label: "Platform fee",
        suffix: "%",
        step: 0.5,
        percent: true,
      },
      {
        key: "mgmtFeePct",
        label: "Property management",
        suffix: "%",
        step: 1,
        percent: true,
        hint: "Leave at 0 if self-managing.",
      },
    ],
  },
];

interface CalculatorInputsProps {
  inputs: DealInputs;
  defaults: DealInputs;
  onChange: (inputs: DealInputs) => void;
  className?: string;
}

/**
 * The live-editing deal calculator. Every keystroke re-runs the whole
 * projection — there is no submit button.
 */
export function CalculatorInputs({
  inputs,
  defaults,
  onChange,
  className,
}: CalculatorInputsProps) {
  const isDirty = React.useMemo(
    () => (Object.keys(defaults) as (keyof DealInputs)[]).some(
      (k) => inputs[k] !== defaults[k]
    ),
    [inputs, defaults]
  );

  const setField = (key: keyof DealInputs, raw: string, percent?: boolean) => {
    const parsed = raw === "" ? 0 : Number.parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    const value = percent ? parsed / 100 : parsed;
    onChange({ ...inputs, [key]: Math.max(0, value) });
  };

  return (
    <div className={cn("rounded-sm border border-border bg-card", className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Deal inputs</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          disabled={!isDirty}
          onClick={() => onChange(defaults)}
        >
          <RotateCcw aria-hidden className="size-3" />
          Reset to comps
        </Button>
      </div>

      <div className="space-y-5 p-4">
        {GROUPS.map((group) => (
          <fieldset key={group.title}>
            <legend>
              <MetricLabel className="pb-2">{group.title}</MetricLabel>
            </legend>
            <div className="space-y-3">
              {group.fields.map((field) => {
                const raw = inputs[field.key];
                const display = field.percent
                  ? Math.round(raw * 1000) / 10
                  : raw;
                const id = `calc-${field.key}`;
                return (
                  <div key={field.key}>
                    <div className="flex items-center justify-between gap-3">
                      <Label
                        htmlFor={id}
                        className="text-xs font-normal text-muted-foreground"
                      >
                        {field.label}
                      </Label>
                      <div className="relative w-32 shrink-0">
                        {field.prefix ? (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
                          >
                            {field.prefix}
                          </span>
                        ) : null}
                        <Input
                          id={id}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={field.step ?? 1}
                          value={display}
                          onChange={(e) =>
                            setField(field.key, e.target.value, field.percent)
                          }
                          className={cn(
                            "h-8 text-right text-sm tabular",
                            field.prefix && "pl-6",
                            field.suffix && "pr-12"
                          )}
                        />
                        {field.suffix ? (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
                          >
                            {field.suffix}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {field.hint ? (
                      <p className="mt-1 text-right text-[11px] leading-snug text-muted-foreground/80">
                        {field.hint}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
