"use client";

import * as React from "react";
import { toast } from "sonner";
import type { StrPolicy } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface FormState {
  name: string;
  company: string;
  phone: string;
  email: string;
  units: string;
  allowsStr: StrPolicy;
  notes: string;
}

const INITIAL: FormState = {
  name: "",
  company: "",
  phone: "",
  email: "",
  units: "1",
  allowsStr: "negotiable",
  notes: "",
};

const FIELD_LABEL = "text-xs font-normal text-muted-foreground";

interface AddLandlordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** New contact form. Name is the only required field. */
export function AddLandlordDialog({ open, onOpenChange }: AddLandlordDialogProps) {
  const { addLandlord } = useSession();
  const [form, setForm] = React.useState<FormState>(INITIAL);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const name = form.name.trim();
  const canSubmit = name.length > 0;

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setForm(INITIAL);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const units = Math.round(Number(form.units));
    addLandlord({
      name,
      company: form.company.trim() || undefined,
      phone: form.phone.trim(),
      email: form.email.trim(),
      unitsControlled: Number.isFinite(units) && units > 0 ? units : 1,
      allowsStr: form.allowsStr,
      notes: form.notes.trim(),
    });
    toast.success(`${name} added`);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add landlord</DialogTitle>
          <DialogDescription>
            A new contact in your private book. Only you will ever see it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ll-add-name" className={FIELD_LABEL}>
              Name
            </Label>
            <Input
              id="ll-add-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Full name"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ll-add-company" className={FIELD_LABEL}>
              Company
            </Label>
            <Input
              id="ll-add-company"
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ll-add-phone" className={FIELD_LABEL}>
                Phone
              </Label>
              <Input
                id="ll-add-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="(555) 000-0000"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ll-add-email" className={FIELD_LABEL}>
                Email
              </Label>
              <Input
                id="ll-add-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="name@example.com"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ll-add-units" className={FIELD_LABEL}>
                Units controlled
              </Label>
              <Input
                id="ll-add-units"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={form.units}
                onChange={(e) => set("units", e.target.value)}
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ll-add-str" className={FIELD_LABEL}>
                Allows STR
              </Label>
              <Select
                value={form.allowsStr}
                onValueChange={(v) => set("allowsStr", v as StrPolicy)}
              >
                <SelectTrigger id="ll-add-str" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="negotiable">Negotiable</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ll-add-notes" className={FIELD_LABEL}>
              Notes
            </Label>
            <Textarea
              id="ll-add-notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="How you met, what they care about, next step"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Add landlord
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
