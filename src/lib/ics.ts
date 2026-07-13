/**
 * Minimal RFC 5545 (iCalendar) generator — enough for a subscribable trip feed,
 * no dependency. Times are emitted as FLOATING local times (no `Z`, no `TZID`):
 * the app stores tz-free "HH:MM" strings and date-only calendar dates, so "09:30"
 * must display as 09:30 in whoever's calendar reads it, wherever the tour is. Items
 * without times, whole-trip spans, and lodging stays become all-day (VALUE=DATE)
 * events, using iCalendar's exclusive DTEND (so a checkout morning is the end date).
 *
 * Pure and unit-tested: all timestamps are passed in (no `new Date()` here), so the
 * caller supplies the generation stamp.
 */

export interface IcsEvent {
  /** Stable, globally-unique id so re-fetches update rather than duplicate. */
  uid: string;
  summary: string;
  location?: string | null;
  description?: string | null;
  /** "YYYYMMDD" (all-day) or "YYYYMMDDTHHMMSS" (floating local). */
  start: string;
  /** Same format as start; omitted for a zero-duration point in time. */
  end?: string | null;
  /** true → DTSTART;VALUE=DATE (all-day); false/undefined → floating datetime. */
  allDay?: boolean;
}

export interface IcsCalendar {
  /** Shown as the calendar's name in most clients (X-WR-CALNAME). */
  name: string;
  events: IcsEvent[];
  /** Generation time as compact UTC "YYYYMMDDTHHMMSSZ" (see formatIcsUtcStamp). */
  dtstamp: string;
}

const CRLF = "\r\n";

/** "2026-07-06" → "20260706". */
export function toIcsDate(ymd: string): string {
  return ymd.replace(/-/g, "");
}

/** ("2026-07-06", "09:30") → "20260706T093000" (floating, no zone). */
export function toIcsFloatingDateTime(ymd: string, hhmm: string): string {
  return `${toIcsDate(ymd)}T${hhmm.replace(/:/g, "")}00`;
}

/** An ISO string (e.g. new Date().toISOString()) → compact UTC "YYYYMMDDTHHMMSSZ". */
export function formatIcsUtcStamp(iso: string): string {
  return `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** Escape a text value per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line to ≤75 octets per RFC 5545 §3.1: continuation lines begin
 * with a single space. We fold on UTF-16 code units, which is safe for the ASCII
 * and BMP text these feeds carry.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  // First chunk 75 chars, subsequent chunks 74 (the leading space counts).
  parts.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    parts.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join(CRLF);
}

function line(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function eventLines(ev: IcsEvent & { dtstamp: string }): string[] {
  const out: string[] = ["BEGIN:VEVENT"];
  out.push(line("UID", ev.uid));
  out.push(line("DTSTAMP", ev.dtstamp));
  if (ev.allDay) {
    out.push(line("DTSTART;VALUE=DATE", ev.start));
    if (ev.end) out.push(line("DTEND;VALUE=DATE", ev.end));
  } else {
    out.push(line("DTSTART", ev.start));
    if (ev.end) out.push(line("DTEND", ev.end));
  }
  out.push(line("SUMMARY", escapeText(ev.summary)));
  if (ev.location) out.push(line("LOCATION", escapeText(ev.location)));
  if (ev.description) out.push(line("DESCRIPTION", escapeText(ev.description)));
  out.push("END:VEVENT");
  return out;
}

export function buildIcsCalendar(cal: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tour Planner//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    line("X-WR-CALNAME", escapeText(cal.name)),
    line("NAME", escapeText(cal.name)),
    // Hint subscribers to re-poll roughly hourly.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const ev of cal.events) {
    lines.push(...eventLines({ ...ev, dtstamp: cal.dtstamp }));
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings and a trailing CRLF.
  return lines.join(CRLF) + CRLF;
}
