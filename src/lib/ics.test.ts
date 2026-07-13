import { describe, it, expect } from "vitest";
import {
  buildIcsCalendar,
  toIcsDate,
  toIcsFloatingDateTime,
  formatIcsUtcStamp,
  type IcsEvent,
} from "./ics";

const STAMP = "20260713T120000Z";

const cal = (events: IcsEvent[]) =>
  buildIcsCalendar({ name: "Test Feed", events, dtstamp: STAMP });

// Unfold folded lines and split into logical content lines.
const lines = (ics: string) =>
  ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);

describe("ics formatters", () => {
  it("toIcsDate strips dashes", () => {
    expect(toIcsDate("2026-07-06")).toBe("20260706");
  });

  it("toIcsFloatingDateTime makes a zoneless stamp", () => {
    expect(toIcsFloatingDateTime("2026-07-06", "09:30")).toBe("20260706T093000");
  });

  it("formatIcsUtcStamp compacts an ISO string", () => {
    expect(formatIcsUtcStamp("2026-07-13T12:00:00.000Z")).toBe("20260713T120000Z");
  });
});

describe("buildIcsCalendar", () => {
  it("wraps events in a VCALENDAR with CRLF line endings and a trailing CRLF", () => {
    const ics = cal([]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("X-WR-CALNAME:Test Feed");
  });

  it("emits a floating timed event with no Z and no TZID", () => {
    const ics = cal([
      {
        uid: "item-1@tp",
        summary: "Visit",
        location: "New Room",
        start: "20260706T093000",
        end: "20260706T110000",
        allDay: false,
      },
    ]);
    const l = lines(ics);
    expect(l).toContain("BEGIN:VEVENT");
    expect(l).toContain("UID:item-1@tp");
    expect(l).toContain("DTSTAMP:20260713T120000Z");
    expect(l).toContain("DTSTART:20260706T093000");
    expect(l).toContain("DTEND:20260706T110000");
    expect(l).toContain("SUMMARY:Visit");
    expect(l).toContain("LOCATION:New Room");
    // No zone designator on the floating times.
    expect(ics).not.toContain("DTSTART:20260706T093000Z");
    expect(ics).not.toContain("TZID");
  });

  it("emits an all-day event with VALUE=DATE and no DTEND when none given", () => {
    const ics = cal([
      { uid: "d@tp", summary: "Day 1", start: "20260706", allDay: true },
    ]);
    const l = lines(ics);
    expect(l).toContain("DTSTART;VALUE=DATE:20260706");
    expect(l.some((x) => x.startsWith("DTEND"))).toBe(false);
  });

  it("omits DTEND for a point-in-time timed event", () => {
    const ics = cal([
      { uid: "p@tp", summary: "Depart", start: "20260706T100000", allDay: false },
    ]);
    const l = lines(ics);
    expect(l).toContain("DTSTART:20260706T100000");
    expect(l.some((x) => x.startsWith("DTEND"))).toBe(false);
  });

  it("escapes special characters in text values", () => {
    const ics = cal([
      {
        uid: "e@tp",
        summary: "Lunch; then walk, part 1\nback by 2",
        start: "20260706",
        allDay: true,
      },
    ]);
    expect(ics).toContain("SUMMARY:Lunch\\; then walk\\, part 1\\nback by 2");
  });

  it("folds content lines longer than 75 octets", () => {
    const long = "A".repeat(200);
    const ics = cal([
      { uid: "f@tp", summary: long, start: "20260706", allDay: true },
    ]);
    // Every physical line must be ≤ 75 chars; continuations start with a space.
    for (const physical of ics.split("\r\n")) {
      expect(physical.length).toBeLessThanOrEqual(75);
    }
    // And it round-trips back to the original when unfolded.
    expect(lines(ics)).toContain(`SUMMARY:${long}`);
  });

  it("gives every event the calendar dtstamp", () => {
    const ics = cal([
      { uid: "a@tp", summary: "A", start: "20260706", allDay: true },
      { uid: "b@tp", summary: "B", start: "20260707", allDay: true },
    ]);
    expect(ics.match(/DTSTAMP:20260713T120000Z/g)?.length).toBe(2);
  });
});
