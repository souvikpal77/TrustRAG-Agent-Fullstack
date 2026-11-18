import { describe, expect, it } from "vitest";

import {
  clamp,
  cn,
  formatBytes,
  formatCompact,
  formatNumber,
  formatPercentValue,
  formatRatio,
  formatScore,
  pluralize,
  shortHash,
  titleCase,
  truncate,
} from "../src/lib/format";

describe("cn", () => {
  it("joins truthy class names and drops falsy values", () => {
    expect(cn("panel", false, null, undefined, "p-4")).toBe("panel p-4");
  });
});

describe("numeric formatting", () => {
  it("formats numbers and falls back to an em dash", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(Number.NaN)).toBe("—");
  });

  it("formats compact values", () => {
    expect(formatCompact(1200)).toBe("1.2K");
  });

  it("distinguishes ratios from percentage values", () => {
    expect(formatRatio(0.625)).toBe("62.5%");
    expect(formatPercentValue(62.5)).toBe("62.5%");
    expect(formatScore(71.234)).toBe("71.2");
  });

  it("formats byte sizes with sensible precision", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});

describe("text helpers", () => {
  it("truncates long text and preserves short text", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(truncate(null)).toBe("—");
  });

  it("normalises labels to title case", () => {
    expect(titleCase("STANDARD_RAG")).toBe("Standard Rag");
    expect(titleCase("trust-rag agent")).toBe("Trust Rag Agent");
  });

  it("shortens hashes without losing short values", () => {
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash("0123456789abcdef", 8)).toBe("01234567…");
    expect(shortHash(null)).toBe("—");
  });

  it("pluralises counts", () => {
    expect(pluralize(1, "claim")).toBe("1 claim");
    expect(pluralize(2, "claim")).toBe("2 claims");
    expect(pluralize(2, "match", "matches")).toBe("2 matches");
  });
});

describe("clamp", () => {
  it("bounds a value to the given range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
