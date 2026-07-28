import { describe, it, expect } from "vitest";
import { getKOLCategory } from "../src/lib/kol.js";

describe("getKOLCategory", () => {
  it.each([
    [0, "LANCAR"],
    [30, "LANCAR"],
    [31, "DALAM_PERHATIAN"],
    [90, "DALAM_PERHATIAN"],
    [91, "KURANG_LANCAR"],
    [120, "KURANG_LANCAR"],
    [121, "DIRAGUKAN"],
    [180, "DIRAGUKAN"],
    [181, "MACET"]
  ] as const)("classifies %i days overdue as %s", (days, expected) => {
    expect(getKOLCategory(days)).toBe(expected);
  });
});
