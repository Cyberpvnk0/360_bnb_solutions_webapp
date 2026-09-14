"use client";

/**
 * Opening a ticket: a subject, what kind of thing it is, and the
 * message.
 *
 * The category is a select rather than free text because it is the one
 * field that has to be machine-readable — it decides how the queue is
 * filtered — and it is pre-answered as "Something else" so the form is
 * submittable without touching it. Nobody should have to classify their
 * own problem before they are allowed to describe it.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  CATEGORY_LABEL,
  MAX_BODY,
  MAX_SUBJECT,
  TICKET_CATEGORIES,
  type TicketCategory,
} from "@/lib/support/ticket";

export function NewTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [subject, setSubject] = React.useState("");
  const [category, setCategory] = React.useState<TicketCategory>("other");
  const [message, setMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const ready = subject.trim().length > 0 && message.trim().length > 0 && !sending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setSending(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, category, message }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; ticket?: { id: string; ref: string } }
        | null;
      if (!res.ok || !data?.ok || !data.ticket) {
        toast.error("That didn't send", {
          description: "Nothing was lost — try again in a moment.",
        });
        return;
      }
      toast.success(`Ticket ${data.ticket.ref} opened`);
      onOpenChange(false);
      setSubject("");
      setMessage("");
      setCategory("other");
      router.push(`/support/${data.ticket.id}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-secondary">
            <LifeBuoy aria-hidden className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg font-semibold tracking-tight">
              Open a ticket
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm">
              Tell us what is happening and we will answer here.
            </DialogDescription>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input
              id="ticket-subject"
              value={subject}
              maxLength={MAX_SUBJECT}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="A short summary"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ticket-category">What is it about?</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as TicketCategory)}
            >
              <SelectTrigger id="ticket-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ticket-message">Message</Label>
            <Textarea
              id="ticket-message"
              value={message}
              maxLength={MAX_BODY}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, and what you expected instead."
              className="min-h-36"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {sending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Sending
                </>
              ) : (
                "Open ticket"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
