// Phone country-code helpers. Dial codes are stored digits-only ("44"); phones
// are stored as a single string, E.164 (`+44…`) once entered via the dial-code
// picker. Legacy free-text values pass through untouched until re-saved.

export type DialCode = { code: string; label: string };

// Curated for the touring footprint (UK/Europe heavy) rather than the full ITU
// list. An unknown code loaded from an existing number is appended dynamically.
export const DIAL_CODES: DialCode[] = [
  { code: "1", label: "US / Canada (+1)" },
  { code: "44", label: "United Kingdom (+44)" },
  { code: "353", label: "Ireland (+353)" },
  { code: "33", label: "France (+33)" },
  { code: "49", label: "Germany (+49)" },
  { code: "39", label: "Italy (+39)" },
  { code: "34", label: "Spain (+34)" },
  { code: "351", label: "Portugal (+351)" },
  { code: "41", label: "Switzerland (+41)" },
  { code: "43", label: "Austria (+43)" },
  { code: "31", label: "Netherlands (+31)" },
  { code: "32", label: "Belgium (+32)" },
  { code: "30", label: "Greece (+30)" },
  { code: "45", label: "Denmark (+45)" },
  { code: "46", label: "Sweden (+46)" },
  { code: "47", label: "Norway (+47)" },
  { code: "420", label: "Czechia (+420)" },
  { code: "48", label: "Poland (+48)" },
  { code: "36", label: "Hungary (+36)" },
  { code: "90", label: "Türkiye (+90)" },
  { code: "972", label: "Israel (+972)" },
  { code: "20", label: "Egypt (+20)" },
  { code: "27", label: "South Africa (+27)" },
  { code: "61", label: "Australia (+61)" },
  { code: "64", label: "New Zealand (+64)" },
];

export const DEFAULT_DIAL_CODE = "1";

// Longest-prefix-first so "+1…" doesn't shadow e.g. "+353…" when splitting.
const CODES_BY_LENGTH = [...DIAL_CODES].sort(
  (a, b) => b.code.length - a.code.length,
);

// Strict-enough E.164 shape for tel:/wa.me links: leading +, 8–15 digits.
export function isE164(phone: string | null | undefined): phone is string {
  return !!phone && /^\+\d{8,15}$/.test(phone);
}

// Digits only — what wa.me wants and what we compose numbers from.
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Split a stored phone into { code, number } for the dial-code editor.
 * `+`-prefixed values split on the longest known dial code (falling back to a
 * 1-digit guess); legacy free-text values load whole into the number box with
 * the caller's default code.
 */
export function splitPhone(
  phone: string | null | undefined,
  defaultCode: string,
): { code: string; number: string } {
  if (!phone || !phone.startsWith("+")) {
    return { code: defaultCode, number: phone ?? "" };
  }
  const digits = phoneDigits(phone);
  const known = CODES_BY_LENGTH.find((c) => digits.startsWith(c.code));
  const code = known?.code ?? digits.slice(0, 1);
  return { code, number: digits.slice(code.length) };
}

/**
 * Compose the stored value from the picker: strip separators and (outside +1)
 * a single leading trunk "0" — "+44 0161…" is a common paste error. An empty
 * number yields "" so clearing the field clears the phone.
 */
export function composePhone(code: string, number: string): string {
  let digits = phoneDigits(number);
  if (!digits) return "";
  if (code !== "1" && digits.startsWith("0")) digits = digits.slice(1);
  return `+${code}${digits}`;
}
