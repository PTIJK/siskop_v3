import { describe, expect, it } from "vitest";
import { hierarchyClass } from "./hierarchy";

describe("hierarchyClass (REPORTS.md §8.2)", () => {
  it("indents by level and bolds group rows", () => {
    expect(hierarchyClass(1, true)).toBe("pl-0 font-bold");
    expect(hierarchyClass(2, true)).toBe("pl-3 font-bold");
    expect(hierarchyClass(3, true)).toBe("pl-6 font-bold");
  });

  it("leaf accounts are regular weight, indented one step past their parent", () => {
    expect(hierarchyClass(1, false)).toBe("pl-0");
    expect(hierarchyClass(2, false)).toBe("pl-3");
    expect(hierarchyClass(4, false)).toBe("pl-9");
  });

  it("caps deep nesting at the last indent step", () => {
    expect(hierarchyClass(9, false)).toBe("pl-9");
    expect(hierarchyClass(9, true)).toBe("pl-9 font-bold");
  });

  it("treats a bad level as the root", () => {
    expect(hierarchyClass(0, false)).toBe("pl-0");
  });
});
