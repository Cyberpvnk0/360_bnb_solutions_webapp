import { describe, expect, it } from "vitest";
import {
  contactSignals,
  extractRedfinContact,
  isListingPageUrl,
} from "./redfin-contact";

/** The contact block as a rental page renders it: a heading naming the
 *  unit, the message form, then the number under the send button. */
const CONTACT_BLOCK = `
  <div class="ContactSection">
    <h2>Contact 1535 Van Buren St</h2>
    <button>Send message</button>
    <span>Text or call <a href="tel:+14072057960">(407) 205-7960</a></span>
  </div>
`;

describe("reading the number off the page", () => {
  it("finds the number the contact block tells you to call", () => {
    expect(extractRedfinContact(CONTACT_BLOCK)?.phone).toBe("(407) 205-7960");
  });

  it("normalises whatever shape the page wrote it in", () => {
    for (const written of [
      "Text or call 407-205-7960",
      "Text or call 407.205.7960",
      "Text or call +1 407 205 7960",
      "Text or call (407)205-7960",
    ]) {
      expect(extractRedfinContact(`<p>${written}</p>`)?.phone).toBe(
        "(407) 205-7960"
      );
    }
  });

  it("reads a tel: link even when no phrase introduces it", () => {
    const doc = `<a href="tel:9045551234">Call</a>`;
    expect(extractRedfinContact(doc)?.phone).toBe("(904) 555-1234");
  });

  it("prefers the contact block's number over one further down the page", () => {
    // The block is the number a human is being told to ring. Anything
    // else on the page is a switchboard until proven otherwise.
    const doc = `${CONTACT_BLOCK}<footer><a href="tel:18448675309">Help</a></footer>`;
    expect(extractRedfinContact(doc)?.phone).toBe("(407) 205-7960");
  });

  it("prefers a local number to a toll-free one at the same confidence", () => {
    // A switchboard is the failure this module is built to avoid: a
    // portal's own line printed under a stranger's address.
    const doc = `<a href="tel:18665551000">A</a><a href="tel:9045551234">B</a>`;
    expect(extractRedfinContact(doc)?.phone).toBe("(904) 555-1234");
  });

  it("reads a bare \"phone\" label, but ranks it under the structured sources", () => {
    // "call" and "phone" are words that also appear in markup and
    // analytics, so they are a last resort rather than the first read.
    expect(extractRedfinContact(`<p>Phone: 904-555-1234</p>`)?.phone).toBe(
      "(904) 555-1234"
    );
    const both =
      `<p>Phone: 904-555-1234</p>` +
      `<script type="application/ld+json">${JSON.stringify({
        agentPhone: "407-205-7960",
      })}</script>`;
    expect(extractRedfinContact(both)?.phone).toBe("(407) 205-7960");
  });

  it("still takes a toll-free number when it is all the page has", () => {
    // Plenty of management companies genuinely use one, and refusing it
    // outright would drop a real contact.
    const doc = `<a href="tel:18665551000">Call</a>`;
    expect(extractRedfinContact(doc)?.phone).toBe("(866) 555-1000");
  });
});

describe("numbers that are not numbers", () => {
  it("refuses the 555-01xx block reserved for fiction", () => {
    // Our own preview inventory uses it. A live row carrying one means
    // an extractor read seeded data, which must never reach a card.
    expect(extractRedfinContact(`<a href="tel:9045550123">x</a>`)).toBeNull();
  });

  it("refuses placeholder runs", () => {
    for (const junk of ["tel:0000000000", "tel:1111111111", "tel:2222222222"]) {
      expect(extractRedfinContact(`<a href="${junk}">x</a>`)).toBeNull();
    }
  });

  it("refuses an area or exchange code that cannot start one", () => {
    // No North American area code or exchange begins with 0 or 1, so a
    // ten-digit run that does is an id, a date, or a price.
    expect(extractRedfinContact(`<p>Text or call 1042057960</p>`)).toBeNull();
    expect(extractRedfinContact(`<p>Text or call 407-105-7960</p>`)).toBeNull();
  });

  it("does not read a longer digit run as a phone number", () => {
    expect(extractRedfinContact(`<p>Call 40720579601234</p>`)).toBeNull();
  });

  it("returns null for a page that publishes nothing", () => {
    // Null is a real answer and the panel says it out loud. Unknown is
    // not none, and neither is a guess.
    expect(extractRedfinContact("<html><body><h1>A house</h1></body></html>")).toBeNull();
  });
});

describe("who the number belongs to", () => {
  it("takes an agent name and a brokerage out of embedded JSON", () => {
    const doc = `<script type="application/ld+json">${JSON.stringify({
      listingAgentName: "Dana Ruiz",
      listingBrokerName: "Coastline Realty",
      agentPhone: "904-555-1234",
    })}</script>`;
    expect(extractRedfinContact(doc)).toEqual({
      name: "Dana Ruiz",
      company: "Coastline Realty",
      phone: "(904) 555-1234",
      role: "Listing agent",
    });
  });

  it("calls a firm on its own a broker, not an agent", () => {
    const doc = `<script type="application/ld+json">${JSON.stringify({
      managementCompany: "Bay Property Group",
      phone: "904-555-1234",
    })}</script>`;
    const contact = extractRedfinContact(doc)!;
    expect(contact.name).toBeUndefined();
    expect(contact.company).toBe("Bay Property Group");
    expect(contact.role).toBe("Listing broker");
  });

  it("says only that it is a listing contact when the page never said whose", () => {
    // The commonest case by far, and the one the type was widened for:
    // a number to ring and no name. Inventing one would put a fiction
    // beside a real telephone number.
    const contact = extractRedfinContact(CONTACT_BLOCK)!;
    expect(contact.name).toBeUndefined();
    expect(contact.role).toBe("Listing contact");
  });

  it("drops a name that is markup, a URL, or a placeholder", () => {
    for (const junk of ["N/A", "unknown", "<span>", "https://example.com", "R"]) {
      const doc = `<script type="application/ld+json">${JSON.stringify({
        agentName: junk,
        phone: "904-555-1234",
      })}</script>`;
      expect(extractRedfinContact(doc)?.name).toBeUndefined();
    }
  });

  it("never names the portal itself as the contact", () => {
    const doc = `<script type="application/ld+json">${JSON.stringify({
      agentName: "Redfin",
      phone: "904-555-1234",
    })}</script>`;
    expect(extractRedfinContact(doc)?.name).toBeUndefined();
  });

  it("survives a malformed blob beside a good one", () => {
    const doc =
      `<script type="application/ld+json">{ not json </script>` +
      `<script type="application/ld+json">${JSON.stringify({
        agentName: "Dana Ruiz",
        phone: "904-555-1234",
      })}</script>`;
    expect(extractRedfinContact(doc)?.name).toBe("Dana Ruiz");
  });

  it("finds a contact nested deep in a framework's state", () => {
    const doc = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { home: { listing: { agentName: "Dana Ruiz" } } } },
    })}</script>`;
    expect(extractRedfinContact(doc)?.name).toBe("Dana Ruiz");
  });
});

describe("what may be fetched at all", () => {
  it("accepts only an https listing page on the source site", () => {
    // This string arrives from a browser and becomes a URL somebody's
    // money fetches, so it is checked rather than trusted.
    expect(isListingPageUrl("https://www.redfin.com/FL/Jacksonville/x/home/1")).toBe(true);
    expect(isListingPageUrl("https://redfin.com/x")).toBe(true);
    expect(isListingPageUrl("http://www.redfin.com/x")).toBe(false);
    expect(isListingPageUrl("https://notredfin.com/x")).toBe(false);
    expect(isListingPageUrl("https://evil.example/redfin.com")).toBe(false);
    expect(isListingPageUrl("javascript:alert(1)")).toBe(false);
    expect(isListingPageUrl("not a url")).toBe(false);
  });
});

describe("the diagnostic probe", () => {
  it("counts what each source found and nothing about what it said", () => {
    // Counts only. A probe that quoted the page would put listing prose
    // on the wire, which is the one thing this module must never do.
    const signals = contactSignals(CONTACT_BLOCK);
    expect(signals.fromContactPhrase).toBeGreaterThan(0);
    expect(signals.fromTelLink).toBe(1);
    expect(signals.looksLikeChallenge).toBe(false);
    expect(Object.values(signals).every((v) => typeof v !== "string")).toBe(true);
  });

  it("says when the page was a block screen rather than a listing", () => {
    // Refused is not "publishes no contact", and the panel says which.
    expect(contactSignals("<p>Press &amp; Hold to confirm you are a human</p>")
      .looksLikeChallenge).toBe(true);
  });
});
