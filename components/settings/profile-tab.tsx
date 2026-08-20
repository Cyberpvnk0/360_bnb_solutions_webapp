"use client";

import * as React from "react";
import { toast } from "sonner";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionUser } from "@/lib/mock/types";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
];

export function ProfileTab() {
  const { ready, user } = useSession();

  if (!ready || !user) {
    return (
      <div className="rounded-sm border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    );
  }

  return <ProfileForm key={user.id} user={user} />;
}

function ProfileForm({ user }: { user: SessionUser }) {
  const [name, setName] = React.useState(user.name);
  const [email, setEmail] = React.useState(user.email);
  const [timezone, setTimezone] = React.useState(TIMEZONES[0].value);

  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Profile</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How your name appears on landlord packets and exports.
        </p>
      </div>

      <div className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-email">Email</Label>
            <Input
              id="settings-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
        </div>

        <div className="mt-4 max-w-xs space-y-2">
          <Label htmlFor="settings-timezone">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="settings-timezone" className="w-full">
              <SelectValue placeholder="Select a timezone" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button className="mt-5" onClick={() => toast.success("Profile saved")}>
          Save
        </Button>
      </div>

      {/* Security */}
      <div className="border-t border-border p-5">
        <h3 className="text-sm font-semibold text-foreground">Security</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Password sign-in comes with the full release.
        </p>
        <Button
          variant="outline"
          className="mt-3 text-muted-foreground"
          onClick={() => toast.success(`Reset link sent to ${email}`)}
        >
          Send reset link
        </Button>
      </div>
    </div>
  );
}
