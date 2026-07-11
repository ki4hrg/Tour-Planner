import { describe, it, expect } from "vitest";
import {
  regionPath,
  regionOptions,
  effectiveDialCode,
  type RegionNode,
} from "./regions";

const england: RegionNode = { id: "e", name: "England", parentId: null };
const london: RegionNode = { id: "l", name: "London", parentId: "e" };
const soho: RegionNode = { id: "s", name: "Soho", parentId: "l" };

const byId = new Map([england, london, soho].map((r) => [r.id, r]));

describe("regionPath", () => {
  it("renders the full ancestry, root first", () => {
    expect(regionPath(soho, byId)).toBe("England › London › Soho");
  });

  it("returns just the name for a top-level region", () => {
    expect(regionPath(england, byId)).toBe("England");
  });

  it("handles a missing parent gracefully (stops at the broken link)", () => {
    const orphan: RegionNode = { id: "o", name: "Orphan", parentId: "gone" };
    expect(regionPath(orphan, new Map([[orphan.id, orphan]]))).toBe("Orphan");
  });

  it("guards against a parent cycle instead of looping forever", () => {
    const a: RegionNode = { id: "a", name: "A", parentId: "b" };
    const b: RegionNode = { id: "b", name: "B", parentId: "a" };
    const cyclic = new Map([a, b].map((r) => [r.id, r]));
    // Walking up from A: prepend B, then A is already seen → stop.
    expect(regionPath(a, cyclic)).toBe("B › A");
  });
});

describe("effectiveDialCode", () => {
  type DialNode = RegionNode & { dialCode?: string | null };
  const dEngland: DialNode = { ...england, dialCode: "44" };
  const dLondon: DialNode = { ...london, dialCode: null };
  const dSoho: DialNode = { ...soho, dialCode: null };
  const dialById = new Map([dEngland, dLondon, dSoho].map((r) => [r.id, r]));

  it("returns the region's own code when set", () => {
    expect(effectiveDialCode("e", dialById)).toBe("44");
  });

  it("inherits from the nearest ancestor that has one", () => {
    expect(effectiveDialCode("l", dialById)).toBe("44");
    expect(effectiveDialCode("s", dialById)).toBe("44");
  });

  it("prefers a child's own code over the ancestor's", () => {
    const scotland: DialNode = { id: "sc", name: "Scotland", parentId: "e", dialCode: "441" };
    const withChild = new Map(dialById);
    withChild.set(scotland.id, scotland);
    expect(effectiveDialCode("sc", withChild)).toBe("441");
  });

  it("returns null when nothing up the chain has a code", () => {
    const bare = new Map(
      [england, london].map((r) => [r.id, { ...r, dialCode: null }]),
    );
    expect(effectiveDialCode("l", bare)).toBeNull();
  });

  it("returns null for a missing or absent region id", () => {
    expect(effectiveDialCode(null, dialById)).toBeNull();
    expect(effectiveDialCode("nope", dialById)).toBeNull();
  });

  it("guards against a parent cycle instead of looping forever", () => {
    const a: DialNode = { id: "a", name: "A", parentId: "b", dialCode: null };
    const b: DialNode = { id: "b", name: "B", parentId: "a", dialCode: null };
    const cyclic = new Map([a, b].map((r) => [r.id, r]));
    expect(effectiveDialCode("a", cyclic)).toBeNull();
  });
});

describe("regionOptions", () => {
  it("labels every region with its path and sorts so children follow parents", () => {
    expect(regionOptions([soho, england, london])).toEqual([
      { id: "e", label: "England" },
      { id: "l", label: "England › London" },
      { id: "s", label: "England › London › Soho" },
    ]);
  });
});
