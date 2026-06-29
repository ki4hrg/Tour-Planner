import { describe, it, expect } from "vitest";
import { regionPath, regionOptions, type RegionNode } from "./regions";

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

describe("regionOptions", () => {
  it("labels every region with its path and sorts so children follow parents", () => {
    expect(regionOptions([soho, england, london])).toEqual([
      { id: "e", label: "England" },
      { id: "l", label: "England › London" },
      { id: "s", label: "England › London › Soho" },
    ]);
  });
});
