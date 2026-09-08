"use client";

/**
 * The account: the name on exports and packets, the email it signs in
 * with, and the password. Everything here does what it says — the name
 * is written to the profile through the server, the password through
 * the auth service — or it is not on the page.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionUser } from "@/lib/mock/types";

/** The auth service's own floor, stated before the field is filled. */
const MIN_PASSWORD = 6;

export function ProfileTab() {
  const { ready, user } = useSession();

  if (!ready || !user) {
    return (
      <div className="rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-5 p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    );
  }

  return <ProfileForm key={user.id} user={user} />;
}

function ProfileForm({ user }: { user: SessionUser }) {
  const { updateName } = useSession();
  const [name, setName] = React.useState(user.name);
  const [savingName, setSavingName] = React.useState(false);

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [savingPassword, setSavingPassword] = React.useState(false);

  const nameDirty = name.trim() !== "" && name.trim() !== user.name;

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameDirty) return;
    setSavingName(true);
    const result = await updateName(name);
    setSavingName(false);
    if ("error" in result) toast.error(result.error);
    else toast.success("Name saved");
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      toast.error(`Password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      toast.error("The two passwords don't match.");
      return;
    }
    setSavingPassword(true);
    // The signed-in session is proof enough for the auth service; no
    // email round trip, no reset link. The error, when there is one, is
    // the service's own words.
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setSavingPassword(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPassword("");
    setConfirm("");
    toast.success("Password changed");
  };

  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-semibold text-foreground">Profile</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How your name appears on landlord packets and exports.
        </p>
      </div>

      <form onSubmit={saveName} className="p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-email">Email</Label>
            <Input
              id="settings-email"
              type="email"
              value={user.email}
              readOnly
              aria-readonly
              className="text-muted-foreground"
            />
            <p className="text-[11px] text-muted-foreground">
              The address you sign in with. It can&apos;t be changed here.
            </p>
          </div>
        </div>

        <Button type="submit" className="mt-5 gap-2" disabled={!nameDirty || savingName}>
          {savingName ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          Save name
        </Button>
      </form>

      <form onSubmit={savePassword} className="border-t border-border p-6">
        <h3 className="text-sm font-semibold text-foreground">Password</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Change the password for {user.email}. Takes effect immediately.
        </p>
        <div className="mt-4 grid max-w-xl gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="settings-password">New password</Label>
            <Input
              id="settings-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              placeholder={`${MIN_PASSWORD}+ characters`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-password-confirm">Confirm</Label>
            <Input
              id="settings-password-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
            />
          </div>
        </div>
        <Button
          type="submit"
          variant="outline"
          className="mt-4 gap-2"
          disabled={!password || !confirm || savingPassword}
        >
          {savingPassword ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          Change password
        </Button>
      </form>
    </div>
  );
}
