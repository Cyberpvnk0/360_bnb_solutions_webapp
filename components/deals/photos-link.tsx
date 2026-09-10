"use client";

/**
 * Out to the page where the pictures already live.
 *
 * We host no listing imagery at all. The card's picture is a Street
 * View or an aerial of the kerb; the interiors live on the listing
 * sites, and this sends people there rather than copying anything
 * here.
 *
 * ONE LABEL, A ROW OF PLACES BEHIND IT. The button opens the first
 * destination lib/live/listing-links can build — the listing's own
 * page when the row carries it, the finder that looks for it
 * otherwise — and the small caret beside it opens the rest in the same
 * order: Zillow, Realtor.com, Homes.com, then the address on Google.
 * The label says "View photos" whichever it opens, because the button
 * is named for what the reader is after rather than for our plumbing;
 * the hover title says which it is.
 *
 * On a surface that shows one property, `find` asks the listing site
 * for the page by address in the background and upgrades the link when
 * it lands. One component for all three surfaces, because the rule
 * about WHEN to show it is the interesting part and it should exist
 * once:
 *
 *   - a real address, or nothing. Seeded preview inventory has
 *     plausible addresses for buildings that do not exist, and a search
 *     for one lands on a stranger's house.
 *   - a link, never an embed. Framing someone's photos inside our
 *     chrome is the thing a link is specifically not.
 */

import { ArrowUpRight, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  hasOwnListingPage,
  photoSources,
  type Addressed,
  type PhotoSource,
} from "@/lib/live/listing-links";
import { cn } from "@/lib/utils";
import { useListingPage } from "./use-listing-page";

type Variant = "button" | "pill" | "chip";

/** The shell, the main link, and the caret, per variant. */
const LOOK: Record<Variant, { shell: string; main: string; caret: string }> = {
  button: {
    shell: "h-8 rounded-sm border border-border text-sm text-foreground",
    main: "px-3 hover:bg-secondary/60",
    caret: "border-l border-border px-1.5 hover:bg-secondary/60",
  },
  pill: {
    shell: "rounded-full bg-black/55 text-[11px] text-white backdrop-blur-[2px]",
    main: "py-1 pl-2.5 pr-2 hover:bg-black/70",
    caret: "border-l border-white/25 px-1.5 hover:bg-black/70",
  },
  chip: {
    shell: "rounded-full border border-border bg-secondary text-xs text-foreground",
    main: "px-3 py-1 hover:bg-secondary/70",
    caret: "border-l border-border px-1.5 hover:bg-secondary/70",
  },
};

/** What a menu entry opens, in a word or two beside its name. */
function hint(source: PhotoSource): string {
  switch (source.id) {
    case "redfin":
      return source.kind === "listing" ? "this listing" : "finds the listing";
    case "zillow":
      return "address page";
    case "google":
      return "the address";
    default:
      return "search";
  }
}

export function PhotosLink({
  place,
  /** False for seeded preview rows — their addresses are generated. */
  real,
  /**
   * True on a surface that shows ONE property: a row without a page
   * asks the listing site for it by address, and the link becomes the
   * listing when the answer lands. Never on a grid — the lookup is a
   * billed request per address.
   */
  find = false,
  /**
   * True while something else on the surface is finding the page (the
   * detail panel's contact lookup does): the link waits for it the
   * same way, without asking a second time.
   */
  pending = false,
  className,
  variant = "button",
}: {
  place: Addressed;
  real: boolean;
  find?: boolean;
  pending?: boolean;
  className?: string;
  /**
   * "button" for an action row, "pill" for an overlay on an image,
   * "chip" for a quiet inline one on a page surface.
   */
  variant?: Variant;
}) {
  const looked = useListingPage(place, find && real && !hasOwnListingPage(place));
  if (!real) return null;
  const sources = photoSources(looked.page ? { ...place, sourceUrl: looked.page } : place);
  const [first] = sources;
  if (!first) return null;

  const onListing = first.kind === "listing";
  // The finder page opens at once and lands on the listing when the
  // lookup answers; while this surface is already asking, the button
  // says so.
  const busy = first.kind === "finding" && (looked.status === "looking" || pending);
  const look = LOOK[variant];

  return (
    <span
      className={cn("inline-flex shrink-0 items-stretch overflow-hidden font-medium", look.shell, className)}
      // Cards open a detail panel on click; this must not do both.
      onClick={(e) => e.stopPropagation()}
    >
      <a
        href={first.href}
        target="_blank"
        rel="noopener noreferrer"
        title={
          onListing
            ? "Opens this property's listing page"
            : busy
              ? "Finding this property's listing page — opens it, or its address page when there is none"
              : "Opens this property's listing page, or its address page when there is none"
        }
        className={cn("inline-flex items-center gap-1 transition-colors duration-150", look.main)}
      >
        View photos
        {busy ? (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <ArrowUpRight aria-hidden className="size-3.5" />
        )}
        {/* The same words a sighted reader gets. A screen reader saying
            something the button does not say is a second label, not a
            better one. */}
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Other places to view photos"
            className={cn("inline-flex items-center transition-colors duration-150", look.caret)}
          >
            <ChevronDown aria-hidden className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        {/* The menu renders in a portal, but its clicks still bubble to
            the card in React; the card must not open its panel. */}
        <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
          {sources.map((source) => (
            <DropdownMenuItem key={source.id} asChild>
              <a
                href={source.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3"
              >
                <span>{source.label}</span>
                <span className="text-[11px] text-muted-foreground">{hint(source)}</span>
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
