import { describe, expect, it } from "vitest";
import { mapHref } from "./maps";

const S = "https://www.google.com/maps/search/?api=1&query=";

describe("mapHref", () => {
  const loc = {
    name: "New Room",
    address: "36 The Horsefair, Bristol",
    googlePlaceId: "ChIJ123",
    lat: 51.4585,
    lng: -2.5903,
  };

  it("prefers a curated mapUrl", () => {
    expect(mapHref({ ...loc, mapUrl: "https://maps.app.goo.gl/x" })).toBe(
      "https://maps.app.goo.gl/x",
    );
  });

  it("then the place ID, queried by name", () => {
    expect(mapHref(loc)).toBe(`${S}New%20Room&query_place_id=ChIJ123`);
  });

  it("then coordinates", () => {
    expect(mapHref({ ...loc, googlePlaceId: null })).toBe(`${S}51.4585,-2.5903`);
  });

  it("then name + address", () => {
    expect(mapHref({ ...loc, googlePlaceId: null, lat: null, lng: null })).toBe(
      `${S}New%20Room%2C%2036%20The%20Horsefair%2C%20Bristol`,
    );
  });

  it("returns null with nothing to link", () => {
    expect(mapHref({})).toBeNull();
  });
});
