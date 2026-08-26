"use client";

/**
 * A listing's photos at full size.
 *
 * The panel crops to a fixed frame so every listing reads the same in a
 * list, which is right there and wrong the moment someone wants to
 * actually look at a room. Here the whole photo is shown, contained
 * rather than cropped, at whatever the screen allows.
 *
 * Portalled to the body: it opens from inside the detail dialog, and a
 * fixed overlay nested in that dialog's own stacking context would sit
 * underneath it.
 *
 * Escape is captured rather than merely handled — the dialog behind is
 * listening for the same key, and without this, one press would close
 * both and drop the student back to the grid.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  caption,
}: {
  photos: string[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  caption: string;
}) {
  const many = photos.length > 1;
  const step = React.useCallback(
    (by: number) => onIndexChange((index + by + photos.length) % photos.length),
    [index, photos.length, onIndexChange]
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (many && event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        step(-1);
      } else if (many && event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        step(1);
      }
    };
    // Capture phase, so the dialog underneath never sees these.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [many, step, onClose]);

  const shown = photos[Math.min(index, photos.length - 1)];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption}
      // Anything that isn't the photo or a control dismisses.
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 sm:p-8"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shown}
        alt={caption}
        // Contained, not cropped: seeing the whole room is the point.
        className="max-h-full max-w-full cursor-default object-contain"
        onClick={(event) => event.stopPropagation()}
      />

      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
      >
        <X aria-hidden className="size-5" />
      </button>

      {many ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(event) => {
              event.stopPropagation();
              step(-1);
            }}
            className="absolute left-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
          >
            <ChevronLeft aria-hidden className="size-6" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={(event) => {
              event.stopPropagation();
              step(1);
            }}
            className="absolute right-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
          >
            <ChevronRight aria-hidden className="size-6" />
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium tabular text-white">
            {index + 1} / {photos.length}
          </span>
        </>
      ) : null}
    </div>,
    document.body
  );
}
