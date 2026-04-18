import { describe, it, expect } from "vitest";
import {
  parseCsvLine,
  parseDate,
  parseNumber,
  splitCsvLines,
  stripBom,
  stripFormulaInjection,
} from "../primitives";

describe("stripFormulaInjection", () => {
  // OWASP CSV injection vectors. Each dangerous prefix must get a leading
  // single-quote so Excel / Sheets treats the cell as text, not a formula.
  const dangerous: Array<[string, string]> = [
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ["+cmd", "'+cmd"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tfoo", "'\tfoo"],
    ["\rbar", "'\rbar"],
  ];

  it.each(dangerous)("prepends quote to %j", (input, expected) => {
    expect(stripFormulaInjection(input)).toBe(expected);
  });

  it("leaves safe values untouched", () => {
    expect(stripFormulaInjection("hello world")).toBe("hello world");
    expect(stripFormulaInjection("2026-04-17")).toBe("2026-04-17");
    expect(stripFormulaInjection("https://linkedin.com/foo")).toBe("https://linkedin.com/foo");
  });

  it("handles empty string", () => {
    expect(stripFormulaInjection("")).toBe("");
  });

  it("only checks first character — dangerous char later is fine", () => {
    // "a=b" is a harmless string, not a formula — only leading char matters.
    expect(stripFormulaInjection("a=b")).toBe("a=b");
  });
});

describe("stripBom", () => {
  it("removes UTF-8 / UTF-16 BOM (U+FEFF)", () => {
    expect(stripBom("\uFEFFDate,Impressions")).toBe("Date,Impressions");
  });

  it("leaves BOM-less input untouched", () => {
    expect(stripBom("Date,Impressions")).toBe("Date,Impressions");
  });

  it("handles empty string", () => {
    expect(stripBom("")).toBe("");
  });
});

describe("parseNumber", () => {
  it("parses plain integer", () => {
    expect(parseNumber("42")).toBe(42);
  });

  it("strips thousand-separator commas", () => {
    expect(parseNumber("1,234,567")).toBe(1234567);
  });

  it("returns 0 for unparseable", () => {
    expect(parseNumber("not a number")).toBe(0);
    expect(parseNumber("")).toBe(0);
    expect(parseNumber(undefined)).toBe(0);
  });

  it("trims whitespace", () => {
    expect(parseNumber("  123  ")).toBe(123);
  });
});

describe("parseCsvLine", () => {
  it("splits on commas", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("respects quoted commas", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    expect(parseCsvLine('a,"he said ""hi""",b')).toEqual(["a", 'he said "hi"', "b"]);
  });

  it("handles trailing empty field", () => {
    expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

describe("parseDate", () => {
  it("parses ISO date", () => {
    const d = parseDate("2026-04-17");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-04-17");
  });

  it("parses 'Feb 14, 2026' style", () => {
    const d = parseDate("Feb 14, 2026");
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("returns null on unparseable", () => {
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe("splitCsvLines", () => {
  it("strips BOM from first line", () => {
    expect(splitCsvLines("\uFEFFa\nb")).toEqual(["a", "b"]);
  });

  it("drops empty lines", () => {
    expect(splitCsvLines("a\n\nb\n")).toEqual(["a", "b"]);
  });
});
