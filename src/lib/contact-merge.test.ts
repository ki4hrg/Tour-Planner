import { describe, expect, it } from "vitest";
import {
  mergeContactFields,
  type MergeableContactFields,
} from "./contact-merge";

const c = (o: Partial<MergeableContactFields> = {}): MergeableContactFields => ({
  name: "Name",
  organization: null,
  role: null,
  email: null,
  phone: null,
  notes: null,
  ...o,
});

describe("mergeContactFields", () => {
  it("keeps the target's values", () => {
    const merged = mergeContactFields(
      c({ name: "Jane Smith", organization: "Abbey", role: "Verger" }),
      c({ name: "J. Smith", organization: "Abbey Trust", role: "Warden" }),
    );
    expect(merged).toMatchObject({
      name: "Jane Smith",
      organization: "Abbey",
      role: "Verger",
    });
  });

  it("fills empty target fields from the source", () => {
    const merged = mergeContactFields(
      c({ name: "Jane", organization: "  " }),
      c({
        organization: "Abbey",
        role: "Verger",
        email: "jane@abbey.org",
        phone: "+44 1",
      }),
    );
    expect(merged).toEqual({
      name: "Jane",
      organization: "Abbey",
      role: "Verger",
      email: "jane@abbey.org",
      phone: "+44 1",
      notes: null,
    });
  });

  it("concatenates notes without duplicating", () => {
    expect(
      mergeContactFields(c({ notes: "Prefers email." }), c({ notes: "Mornings only." }))
        .notes,
    ).toBe("Prefers email.\n\nMornings only.");
    expect(
      mergeContactFields(c({ notes: "Same." }), c({ notes: "Same." })).notes,
    ).toBe("Same.");
    expect(mergeContactFields(c(), c({ notes: "From source." })).notes).toBe(
      "From source.",
    );
  });

  it("keeps a differing source email/phone in the notes", () => {
    const merged = mergeContactFields(
      c({ email: "jane@abbey.org", phone: "+44 1", notes: "Verger." }),
      c({ email: "jane@gmail.com", phone: "+44 2" }),
    );
    expect(merged.email).toBe("jane@abbey.org");
    expect(merged.phone).toBe("+44 1");
    expect(merged.notes).toBe("Verger.\n\nAlso: jane@gmail.com, +44 2");
  });

  it("treats an email differing only by case as the same", () => {
    const merged = mergeContactFields(
      c({ email: "Jane@Abbey.org" }),
      c({ email: "jane@abbey.org" }),
    );
    expect(merged.notes).toBeNull();
  });
});
