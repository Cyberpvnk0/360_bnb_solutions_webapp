import { describe, expect, it } from "vitest";
import {
  formatAddressLine,
  fromCensusCandidate,
  fromGooglePrediction,
  fromMapboxFeature,
  titleCase,
} from "./address-suggest";

describe("address line", () => {
  it("prints street, city, state and ZIP and skips what is missing", () => {
    expect(
      formatAddressLine({ street: "2625 Pintail Dr", city: "Columbia", state: "SC", zip: "29229" })
    ).toBe("2625 Pintail Dr, Columbia, SC 29229");
    expect(formatAddressLine({ street: "2625 Pintail Dr", city: "Columbia", state: "SC", zip: "" })).toBe(
      "2625 Pintail Dr, Columbia, SC"
    );
    expect(formatAddressLine({ street: "2625 Pintail Dr", city: "", state: "", zip: "" })).toBe(
      "2625 Pintail Dr"
    );
  });

  it("title-cases the Census's shouting without mangling ordinals or directions", () => {
    expect(titleCase("2625 PINTAIL DR")).toBe("2625 Pintail Dr");
    expect(titleCase("101 5TH AVE NE")).toBe("101 5th Ave NE");
  });
});

describe("mapbox features", () => {
  const feature = {
    properties: {
      feature_type: "address",
      name: "2625 Pintail Drive",
      full_address: "2625 Pintail Drive, Columbia, South Carolina 29229, United States",
      coordinates: { longitude: -80.94, latitude: 34.09 },
      context: {
        place: { name: "Columbia" },
        region: { region_code: "SC", name: "South Carolina" },
        postcode: { name: "29229" },
      },
    },
  };

  it("carries street, city, state code, ZIP and the point", () => {
    expect(fromMapboxFeature(feature)).toEqual({
      address: "2625 Pintail Drive, Columbia, SC 29229",
      street: "2625 Pintail Drive",
      city: "Columbia",
      state: "SC",
      zip: "29229",
      point: { lat: 34.09, lon: -80.94 },
      source: "mapbox",
    });
  });

  it("drops anything that is not an address with a point", () => {
    expect(fromMapboxFeature({ properties: { ...feature.properties, feature_type: "place" } })).toBeNull();
    expect(
      fromMapboxFeature({ properties: { ...feature.properties, coordinates: undefined } })
    ).toBeNull();
    expect(fromMapboxFeature(null)).toBeNull();
  });
});

describe("google predictions", () => {
  it("splits city and state out of the secondary text and drops the country", () => {
    const s = fromGooglePrediction({
      placePrediction: {
        placeId: "abc",
        structuredFormat: {
          mainText: { text: "2625 Pintail Drive" },
          secondaryText: { text: "Columbia, SC, USA" },
        },
      },
    });
    expect(s).toEqual({
      address: "2625 Pintail Drive, Columbia, SC",
      street: "2625 Pintail Drive",
      city: "Columbia",
      state: "SC",
      zip: "",
      point: null,
      source: "google",
    });
  });
});

describe("census candidates", () => {
  it("reads the normalised line into parts and tidies the case", () => {
    const s = fromCensusCandidate({
      address: "2625 PINTAIL DR, COLUMBIA, SC, 29229",
      point: { lat: 34.09, lon: -80.94 },
    });
    expect(s.address).toBe("2625 Pintail Dr, Columbia, SC 29229");
    expect(s.zip).toBe("29229");
    expect(s.source).toBe("census");
  });
});
