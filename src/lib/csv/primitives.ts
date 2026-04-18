// CSV parsing primitives shared by X and LinkedIn importers.
//
// The existing `csv-parser.ts` defines `parseCsvLine` and `parseNumber`
// inline; those are lifted here so the LinkedIn importer can reuse them
// without duplication. Added: `stripFormulaInjection` (defense against
// Excel formula execution when a user re-opens the exported CSV), `stripBom`
// (LinkedIn exports as UTF-16 with BOM), and `parseDate`.

/**
 * Characters that, when placed at the start of a CSV cell, cause Excel /
 * Google Sheets to interpret the cell as a formula. If an attacker can
 * influence any cell value that later ends up in an exported CSV, they can
 * execute formulas on the victim's machine — see OWASP "Formula Injection".
 *
 * The mitigation: prepend a single quote to any cell whose first character
 * matches one of these. The quote is not rendered by Excel but disables
 * formula parsing.
 */
const DANGEROUS_PREFIXES = ["=", "+", "-", "@", "\t", "\r"] as const;

export function stripFormulaInjection(value: string): string {
  if (value.length === 0) return value;
  const first = value[0];
  if (DANGEROUS_PREFIXES.includes(first as (typeof DANGEROUS_PREFIXES)[number])) {
    return `'${value}`;
  }
  return value;
}

/**
 * Remove UTF-8 and UTF-16 byte-order marks. LinkedIn exports CSV as
 * UTF-16LE with a BOM; after decoding to string the BOM survives as U+FEFF
 * and breaks header matching if not stripped.
 */
export function stripBom(raw: string): string {
  if (raw.length === 0) return raw;
  const first = raw.charCodeAt(0);
  // U+FEFF is the BOM for both UTF-8 (after decode) and UTF-16 BE/LE.
  if (first === 0xfeff) return raw.slice(1);
  return raw;
}

/**
 * Parse an integer from a CSV cell. Strips commas (thousand separators)
 * and whitespace. Returns 0 on unparseable input — keeps aggregation
 * callers simple; if you need "null on missing", check the raw string
 * before calling.
 */
export function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const n = parseInt(value.replace(/,/g, "").trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parse a CSV line respecting RFC 4180 quoted fields (quotes escaped as
 * `""` inside a quoted value). Does not handle multi-line quoted values —
 * LinkedIn and X exports do not use them, but callers with such input must
 * preprocess.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse a date from a CSV cell. Accepts ISO strings, common US / EU
 * formats, and the "Feb 14, 2026" style X exports use. Returns `null` on
 * unparseable input — the caller must decide whether to skip the row or
 * abort the import.
 */
export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Split raw CSV text into non-empty lines, stripping any BOM from the
 * first line. Centralizes the "lines.trim().split('\n').filter(Boolean)"
 * dance so callers don't each reimplement it.
 */
export function splitCsvLines(raw: string): string[] {
  return stripBom(raw).trim().split("\n").filter(Boolean);
}
