import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPlaceId, searchPlaceCandidates, toPlaceDetails } from "./google-places";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("google-places", () => {
  beforeEach(() => vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("toPlaceDetails keeps coordinates both-or-neither", () => {
    expect(
      toPlaceDetails({ id: "p1", location: { latitude: 51.5, longitude: -0.1 } }),
    ).toMatchObject({ placeId: "p1", lat: 51.5, lng: -0.1 });
    expect(toPlaceDetails({ id: "p1", location: { latitude: 51.5 } })).toMatchObject({
      lat: null,
      lng: null,
    });
    expect(toPlaceDetails({})).toBeNull();
  });

  it("refreshPlaceId asks for the id-only field mask and returns the current ID", async () => {
    const fetch = mockFetch(200, { id: "new-id" });
    await expect(refreshPlaceId("old-id")).resolves.toEqual({
      status: "ok",
      placeId: "new-id",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places/old-id");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("id");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
  });

  it("refreshPlaceId maps 404 to not_found and rethrows other failures", async () => {
    mockFetch(404, { error: { status: "NOT_FOUND" } });
    await expect(refreshPlaceId("gone")).resolves.toEqual({ status: "not_found" });
    mockFetch(429, { error: { status: "RESOURCE_EXHAUSTED" } });
    await expect(refreshPlaceId("x")).rejects.toThrow(/429/);
  });

  it("searchPlaceCandidates uses the backfill field mask", async () => {
    const fetch = mockFetch(200, {
      places: [
        {
          id: "c1",
          displayName: { text: "New Room" },
          formattedAddress: "36 The Horsefair, Bristol",
          location: { latitude: 51.4585, longitude: -2.5903 },
        },
      ],
    });
    const out = await searchPlaceCandidates("New Room, Bristol");
    expect(out).toEqual([
      {
        placeId: "c1",
        name: "New Room",
        address: "36 The Horsefair, Bristol",
        lat: 51.4585,
        lng: -2.5903,
      },
    ]);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(
      "places.id,places.location,places.displayName,places.formattedAddress",
    );
  });

  it("refuses to call Google without a key", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    await expect(refreshPlaceId("x")).rejects.toThrow(/not configured/);
  });
});
