// Helpers for the hierarchical Region catalog (e.g. England → London).

export type RegionNode = { id: string; name: string; parentId: string | null };

// A region's full ancestry as a display path, e.g. "England › London › Soho".
// Guards against cycles (a malformed parent chain) by tracking visited ids.
export function regionPath(
  region: RegionNode,
  byId: Map<string, RegionNode>,
): string {
  const parts = [region.name];
  const seen = new Set([region.id]);
  let cur = region.parentId ? byId.get(region.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    parts.unshift(cur.name);
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ");
}

// The dial code in effect for a region: its own, else the nearest ancestor's
// (admins set it on top-level regions like England; children inherit). Returns
// null when nothing up the chain has one. Cycle-guarded like regionPath.
export function effectiveDialCode(
  regionId: string | null | undefined,
  byId: Map<string, RegionNode & { dialCode?: string | null }>,
): string | null {
  const seen = new Set<string>();
  let cur = regionId ? byId.get(regionId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (cur.dialCode) return cur.dialCode;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

// Flat, hierarchy-pathed options for a region <select>, sorted by their path so
// children sit under their parents alphabetically.
export function regionOptions(
  regions: RegionNode[],
): { id: string; label: string }[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  return regions
    .map((r) => ({ id: r.id, label: regionPath(r, byId) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
