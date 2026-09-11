/**
 * The one question the comps feed cannot answer.
 *
 * These pin the reading of a room page and the shape of a pass. What
 * they cannot pin is the platform's markup, which is why the reader
 * below treats anything it does not recognise as unknown and every
 * unknown keeps its comp: the failure this must never have is a
 * projection thinned because a scraper had a bad minute.
 */

import { describe, expect, it } from "vitest";
import { listingIdOf, readLiveness, roomUrl } from "./listing-live";

const ID = "1543862258407149646";

const livePage = `<!doctype html><html><head>
  <meta property="og:title" content="Salted Heat Pool">
  <link rel="canonical" href="https://www.airbnb.com/rooms/${ID}"/>
</head><body>…</body></html>`;

const errorPage = `<!doctype html><html><head><title>Airbnb</title></head>
  <body><h1>Something went wrong</h1>
  <p>Airbnb may be undergoing maintenance or your connection may have timed out.</p>
  </body></html>`;

describe("what a room page says about itself", () => {
  it("is live when the page names this listing as its own", () => {
    expect(readLiveness(livePage, ID)).toBe("live");
    expect(
      readLiveness(`<meta property="og:url" content="https://www.airbnb.com/rooms/${ID}">`, ID)
    ).toBe("live");
  });

  it("is gone on the platform's own error shell", () => {
    expect(readLiveness(errorPage, ID)).toBe("gone");
  });

  it("is unknown when the page is neither, rather than guessing", () => {
    // Whatever this is, it is not evidence that a listing came down,
    // and recording it as such would drop a live comp from a
    // projection.
    expect(readLiveness("<html><body>hello</body></html>", ID)).toBe("unknown");
    expect(readLiveness("", ID)).toBe("unknown");
  });

  it("does not take another listing's page for this one", () => {
    // A redirect to a different room is not this room being live.
    expect(
      readLiveness(`<link rel="canonical" href="https://www.airbnb.com/rooms/99999999"/>`, ID)
    ).toBe("unknown");
  });

  it("reads only the head, so a review cannot condemn a listing", () => {
    const long = `${livePage}${"x".repeat(80_000)}no longer available`;
    expect(readLiveness(long, ID)).toBe("live");
  });
});

describe("which listing a comp stands for", () => {
  it("is the platform id inside a live comp's own id", () => {
    expect(listingIdOf(`sc-live-${ID}`)).toBe(ID);
    expect(listingIdOf("sc-live-41234567")).toBe("41234567");
  });

  it("is nothing for a seeded comp, which has no page", () => {
    expect(listingIdOf("sc-7")).toBeNull();
    expect(listingIdOf("sc-live-abc")).toBeNull();
  });

  it("builds the page it asks about", () => {
    expect(roomUrl(ID)).toBe(`https://www.airbnb.com/rooms/${ID}`);
  });
});
