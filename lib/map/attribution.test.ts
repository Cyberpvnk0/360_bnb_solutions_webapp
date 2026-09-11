import { describe, expect, it } from "vitest";
import {
  BADGE_CLASS,
  EXPANDED_CLASS,
  SETTLE_EVENTS,
  autoCollapseAttribution,
  collapseAttribution,
  isBadgeClick,
  type AttributionHost,
} from "./attribution";

/** A stand-in for one MapLibre attribution control. */
function control(classes: string[]) {
  const set = new Set(classes);
  return {
    classes: set,
    classList: {
      remove(name: string) {
        set.delete(name);
      },
    },
  };
}

/** A stand-in for the map container the control lives in. */
function scope(controls: ReturnType<typeof control>[]) {
  const listeners: ((event: { target: unknown }) => void)[] = [];
  return {
    listeners,
    querySelectorAll() {
      return controls.filter(
        (c) => c.classes.has("maplibregl-ctrl-attrib") && c.classes.has(EXPANDED_CLASS)
      );
    },
    addEventListener(_type: string, fn: (event: { target: unknown }) => void) {
      listeners.push(fn);
    },
    removeEventListener(_type: string, fn: (event: { target: unknown }) => void) {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
}

/** A stand-in for the map, recording what it was asked to listen to. */
function fakeMap(container: ReturnType<typeof scope>) {
  const handlers = new Map<string, Set<() => void>>();
  const host: AttributionHost = {
    getContainer: () => container,
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    off(type, fn) {
      handlers.get(type)?.delete(fn);
    },
  };
  return {
    host,
    handlers,
    fire(type: string) {
      for (const fn of handlers.get(type) ?? []) fn();
    },
  };
}

const expanded = () => control(["maplibregl-ctrl", "maplibregl-ctrl-attrib", "maplibregl-compact", EXPANDED_CLASS]);

describe("collapseAttribution", () => {
  it("drops the expanded class and reports what it folded", () => {
    const bar = expanded();
    expect(collapseAttribution(scope([bar]))).toBe(1);
    expect(bar.classes.has(EXPANDED_CLASS)).toBe(false);
  });

  it("leaves the control itself in place — the credit has to stay on the map", () => {
    const bar = expanded();
    collapseAttribution(scope([bar]));
    expect(bar.classes.has("maplibregl-ctrl-attrib")).toBe(true);
    expect(bar.classes.has("maplibregl-compact")).toBe(true);
  });

  it("is a no-op on a control that is already folded", () => {
    const bar = control(["maplibregl-ctrl-attrib", "maplibregl-compact"]);
    expect(collapseAttribution(scope([bar]))).toBe(0);
  });

  it("folds every control it finds", () => {
    const bars = [expanded(), expanded()];
    expect(collapseAttribution(scope(bars))).toBe(2);
    expect(bars.every((b) => !b.classes.has(EXPANDED_CLASS))).toBe(true);
  });
});

describe("isBadgeClick", () => {
  const badge = { closest: (sel: string) => (sel === `.${BADGE_CLASS}` ? {} : null) };

  it("recognises a click on the badge", () => {
    expect(isBadgeClick(badge)).toBe(true);
  });

  it("ignores a click elsewhere on the map", () => {
    expect(isBadgeClick({ closest: () => null })).toBe(false);
  });

  it("survives a target that is not an element", () => {
    expect(isBadgeClick(null)).toBe(false);
    expect(isBadgeClick(undefined)).toBe(false);
    expect(isBadgeClick({})).toBe(false);
  });
});

describe("autoCollapseAttribution", () => {
  it("folds the bar the moment it is installed", () => {
    const bar = expanded();
    const container = scope([bar]);
    autoCollapseAttribution(fakeMap(container).host);
    expect(bar.classes.has(EXPANDED_CLASS)).toBe(false);
  });

  it("folds it again after MapLibre refills the credits", () => {
    const bar = expanded();
    const container = scope([bar]);
    const map = fakeMap(container);
    autoCollapseAttribution(map.host);

    for (const event of SETTLE_EVENTS) {
      bar.classes.add(EXPANDED_CLASS); // what a refill does
      map.fire(event);
      expect(bar.classes.has(EXPANDED_CLASS)).toBe(false);
    }
  });

  it("stops interfering once the reader opens the credits", () => {
    const bar = expanded();
    const container = scope([bar]);
    const map = fakeMap(container);
    autoCollapseAttribution(map.host);

    // The reader clicks the badge; MapLibre's own handler expands it.
    for (const fn of container.listeners) {
      fn({ target: { closest: (sel: string) => (sel === `.${BADGE_CLASS}` ? {} : null) } });
    }
    bar.classes.add(EXPANDED_CLASS);

    map.fire("sourcedata");
    expect(bar.classes.has(EXPANDED_CLASS)).toBe(true);
  });

  it("keeps folding after a click that missed the badge", () => {
    const bar = expanded();
    const container = scope([bar]);
    const map = fakeMap(container);
    autoCollapseAttribution(map.host);

    for (const fn of container.listeners) fn({ target: { closest: () => null } });
    bar.classes.add(EXPANDED_CLASS);

    map.fire("idle");
    expect(bar.classes.has(EXPANDED_CLASS)).toBe(false);
  });

  it("lets go of every listener on teardown", () => {
    const bar = expanded();
    const container = scope([bar]);
    const map = fakeMap(container);
    const stop = autoCollapseAttribution(map.host);

    expect(container.listeners.length).toBe(1);
    stop();
    expect(container.listeners.length).toBe(0);
    for (const event of SETTLE_EVENTS) expect(map.handlers.get(event)?.size ?? 0).toBe(0);

    bar.classes.add(EXPANDED_CLASS);
    for (const event of SETTLE_EVENTS) map.fire(event);
    expect(bar.classes.has(EXPANDED_CLASS)).toBe(true);
  });
});
