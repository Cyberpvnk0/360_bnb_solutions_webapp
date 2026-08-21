"use client";

import * as React from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
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

/**
 * Dumb simple by default: the five numbers every deal needs. Everything
 * else lives behind Advanced with sensible comps-derived defaults.
 */
const BASIC_FIELDS: FieldSpec[] = [
  { key: "monthlyRent", label: "Monthly lease rent", prefix: "$", step: 25 },
  { key: "securityDeposit", label: "Security deposit", prefix: "$", step: 100 },
  { key: "furnishingBudget", label: "Furnishing budget", prefix: "$", step: 250 },
  { key: "utilitiesMonthly", label: "Utilities", prefix: "$", step: 10 },
  {
    key: "platformFeePct",
    label: "Airbnb host fee",
    suffix: "%",
    step: 0.5,
    percent: true,
    hint: "The platform's cut of each booking. 3% is typical.",
  },
];

/** Cleaning has no input on purpose: the guest's cleaning fee pays the
 *  cleaner, so it nets out of the deal's P&L. */
const ADVANCED_GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Monthly operating",
    fields: [
      { key: "internetMonthly", label: "Internet", prefix: "$", step: 5 },
      { key: "suppliesMonthly", label: "Supplies", prefix: "$", step: 5 },
      { key: "insuranceMonthly", label: "Insurance", prefix: "$", step: 5 },
    ],
  },
  {
    title: "Management",
    fields: [
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

const ADVANCED_KEYS = ADVANCED_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

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
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const isDirty = React.useMemo(
    () =>
      (Object.keys(defaults) as (keyof DealInputs)[]).some(
        (k) => inputs[k] !== defaults[k]
      ),
    [inputs, defaults]
  );
  const advancedDirtyCount = ADVANCED_KEYS.filter(
    (k) => inputs[k] !== defaults[k]
  ).length;

  const setField = (key: keyof DealInputs, raw: string, percent?: boolean) => {
    const parsed = raw === "" ? 0 : Number.parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    const value = percent ? parsed / 100 : parsed;
    onChange({ ...inputs, [key]: Math.max(0, value) });
  };

  const renderField = (field: FieldSpec) => {
    const raw = inputs[field.key];
    // Strip float noise (0.03 × 100 → 3.0000000000000004) without
    // truncating what the user typed (3.75 stays 3.75).
    const display = field.percent
      ? Number.parseFloat((raw * 100).toPrecision(12))
      : raw;
    const id = `calc-${field.key}`;
    return (
      <div key={field.key}>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
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
              onChange={(e) => setField(field.key, e.target.value, field.percent)}
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
  };

  return (
    <div className={cn("rounded-sm border border-border bg-card", className)}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
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

      <div className="space-y-3.5 p-5">
        {BASIC_FIELDS.map(renderField)}
      </div>

      {/* Advanced disclosure */}
      <div className="border-t border-border">
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls="calc-advanced"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors duration-150 hover:bg-secondary/40"
        >
          <span className="text-xs font-medium text-foreground">
            Advanced
            <span className="ml-2 font-normal text-muted-foreground">
              {advancedDirtyCount > 0
                ? `${advancedDirtyCount} adjusted`
                : "internet, supplies, insurance, management"}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-150",
              advancedOpen && "rotate-180"
            )}
          />
        </button>
        {advancedOpen ? (
          <div id="calc-advanced" className="space-y-7 border-t border-border p-5">
            {ADVANCED_GROUPS.map((group) => (
              <fieldset key={group.title}>
                <legend>
                  <MetricLabel className="pb-2">{group.title}</MetricLabel>
                </legend>
                <div className="space-y-3.5">{group.fields.map(renderField)}</div>
              </fieldset>
            ))}
          </div>
        ) : null}
      </div>

      <p className="border-t border-border px-5 py-3 text-[11px] leading-snug text-muted-foreground">
        Advanced costs start at $0 — add the ones that apply to your deal.
        Cleaning never appears here: the guest&apos;s cleaning fee pays the
        cleaner.
      </p>
    </div>
  );
}
