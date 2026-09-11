"use client";

/**
 * Keep a market. The row already existed — an account has carried a
 * list of watched market slugs since the tables were written — and
 * nothing in the product had put a button on it since the old market
 * pages went away.
 *
 * Saving is not a purchase and changes nothing about what the market
 * shows; it is a shortlist, and the Saved page reads it back.
 */

import * as React from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SaveMarketButton({
  slug,
  name,
  className,
  size = "sm",
}: {
  slug: string;
  name: string;
  className?: string;
  size?: "sm" | "default" | "icon";
}) {
  const { user, watchedMarketSlugs, toggleWatchMarket } = useSession();
  const saved = watchedMarketSlugs.includes(slug);

  if (!user) return null;

  return (
    <Button
      type="button"
      variant={saved ? "secondary" : "outline"}
      size={size}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleWatchMarket(slug);
        toast.success(saved ? `Removed ${name}` : `Saved ${name}`, {
          description: saved ? undefined : "Find it under Saved · Markets.",
        });
      }}
      className={cn("gap-1.5", className)}
    >
      {saved ? (
        <BookmarkCheck aria-hidden className="size-3.5" />
      ) : (
        <Bookmark aria-hidden className="size-3.5" />
      )}
      {saved ? "Saved" : "Save market"}
    </Button>
  );
}
