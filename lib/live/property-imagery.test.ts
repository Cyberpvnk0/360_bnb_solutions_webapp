import { describe, expect, it } from "vitest";

import {
  firstStage,
  nextStage,
  propertyImageSrc,
  STAGE_LABEL,
} from "./property-imagery";

describe("the imagery chain a card walks", () => {
  it("starts at the best source the deployment has", () => {
    expect(firstStage({ street: true, aerial: true })).toBe("street");
    expect(firstStage({ street: true, aerial: false })).toBe("street");
    expect(firstStage({ street: false, aerial: true })).toBe("aerial");
    expect(firstStage({ street: false, aerial: false })).toBe("sketch");
  });

  it("falls from the kerb to the roof only when there is a roof to fall to", () => {
    // Google has no kerb shot for this coordinate; the aerial covers.
    expect(nextStage("street", { street: true, aerial: true })).toBe("aerial");
    // No Mapbox token: straight to the sketch, never a blank.
    expect(nextStage("street", { street: true, aerial: false })).toBe("sketch");
  });

  it("ends at the sketch from anywhere else", () => {
    expect(nextStage("aerial", { street: true, aerial: true })).toBe("sketch");
    expect(nextStage("sketch", { street: true, aerial: true })).toBe("sketch");
  });

  it("asks the route for one source at a time", () => {
    // The label is written from the stage that loaded, which is only
    // honest if the route cannot quietly substitute the next source.
    expect(propertyImageSrc(30.3, -81.6, "street")).toBe(
      "/api/property-image?lat=30.3&lon=-81.6&source=street"
    );
    expect(propertyImageSrc(30.3, -81.6, "aerial")).toBe(
      "/api/property-image?lat=30.3&lon=-81.6&source=aerial"
    );
    expect(propertyImageSrc(30.3, -81.6)).toBe("/api/property-image?lat=30.3&lon=-81.6");
  });

  it("names the picture, never its absence", () => {
    expect(STAGE_LABEL.street).toBe("Street View");
    expect(STAGE_LABEL.aerial).toBe("Aerial");
    for (const label of Object.values(STAGE_LABEL)) {
      expect(label.toLowerCase()).not.toContain("photo");
    }
  });
});
