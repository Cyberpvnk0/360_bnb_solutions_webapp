"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

interface NotificationPref {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
}

const PREFS: NotificationPref[] = [
  {
    id: "digest",
    label: "Weekly market digest",
    description:
      "ADR and occupancy moves across your watched markets, every Monday.",
    defaultOn: true,
  },
  {
    id: "receipts",
    label: "Pull receipts",
    description: "A record of each address pull, sent as it happens.",
    defaultOn: true,
  },
  {
    id: "reminders",
    label: "Deal stage reminders",
    description: "A nudge when a pipeline deal sits in one stage too long.",
    defaultOn: true,
  },
  {
    id: "updates",
    label: "Product updates",
    description: "New data coverage and features, at most once a month.",
    defaultOn: false,
  },
];

export function NotificationsTab() {
  const [prefs, setPrefs] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(PREFS.map((p) => [p.id, p.defaultOn]))
  );

  const toggle = (id: string, on: boolean) => {
    setPrefs((prev) => ({ ...prev, [id]: on }));
    toast.success("Preferences saved");
  };

  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What lands in your inbox. Changes apply immediately.
        </p>
      </div>
      <div className="divide-y divide-border">
        {PREFS.map((pref) => (
          <div
            key={pref.id}
            className="flex items-center justify-between gap-6 px-6 py-5"
          >
            <div className="min-w-0">
              <label
                htmlFor={`pref-${pref.id}`}
                className="text-sm font-medium text-foreground"
              >
                {pref.label}
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {pref.description}
              </p>
            </div>
            <Switch
              id={`pref-${pref.id}`}
              checked={prefs[pref.id]}
              onCheckedChange={(on) => toggle(pref.id, on)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
