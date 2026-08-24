"use client";

/**
 * "Add to list" — the organizing move. Every list the hunter has made
 * shows with a checkbox; a name field at the bottom creates a new one
 * and drops the rental straight into it, so organizing never costs a
 * detour away from the listing.
 */

import * as React from "react";
import { Check, FolderPlus, ListPlus, Plus, X } from "lucide-react";
import type { RentalListing } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function AddToListMenu({ listing }: { listing: RentalListing }) {
  const {
    lists,
    createList,
    deleteList,
    toggleListMembership,
    listsWithListing,
    ready,
  } = useSession();
  const [open, setOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const memberOf = listsWithListing(listing.id);
  const saved = memberOf.length > 0;

  const addToNewList = () => {
    const name = newName.trim();
    if (!name) return;
    const created = createList(name);
    toggleListMembership(created.id, listing);
    setNewName("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={saved ? "outline" : "default"}
          size="sm"
          disabled={!ready}
          className={saved ? "border-gold/50 text-gold" : undefined}
        >
          {saved ? (
            <>
              <Check aria-hidden className="size-4" />
              {memberOf.length === 1
                ? `In ${lists.find((l) => l.id === memberOf[0])?.name ?? "a list"}`
                : `In ${memberOf.length} lists`}
            </>
          ) : (
            <>
              <ListPlus aria-hidden className="size-4" />
              Add to list
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="max-h-56 overflow-y-auto p-1.5">
          {lists.map((list) => {
            const on = memberOf.includes(list.id);
            return (
              <div key={list.id} className="group/row flex items-center gap-0.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleListMembership(list.id, listing)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors duration-150",
                    on
                      ? "text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-xs border",
                      on ? "border-gold/60 bg-gold-fill/10" : "border-border"
                    )}
                  >
                    {on ? <Check className="size-3 text-gold" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{list.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular">
                    {list.listings.length}
                  </span>
                </button>
                {/* Lists persist on this device, so they need a way out. */}
                <button
                  type="button"
                  aria-label={`Delete the list ${list.name}`}
                  onClick={() => deleteList(list.id)}
                  className="shrink-0 rounded-sm p-1.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 border-t border-border p-2">
          <FolderPlus
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addToNewList();
              }
            }}
            placeholder="New list name…"
            aria-label="New list name"
            className="h-8 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={addToNewList}
            disabled={!newName.trim()}
            aria-label="Create list and add"
          >
            <Plus aria-hidden className="size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
