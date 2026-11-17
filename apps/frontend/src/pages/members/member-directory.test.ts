import { describe, expect, it } from "vitest";
import { provisionalPage } from "./member-directory";

describe("main Anggota directory pagination", () => {
  it("fills the boundary page and never repeats pending rows across pages", () => {
    const pending = ["TMP-1", "TMP-2", "TMP-3", "TMP-4", "TMP-5", "TMP-6"];
    expect(provisionalPage(pending, 5, 3, 1, 3)).toEqual([]);
    expect(provisionalPage(pending, 5, 2, 2, 3)).toEqual(["TMP-1"]);
    expect(provisionalPage(pending, 5, 0, 3, 3)).toEqual(["TMP-2", "TMP-3", "TMP-4"]);
    expect(provisionalPage(pending, 5, 0, 4, 3)).toEqual(["TMP-5", "TMP-6"]);
    expect(provisionalPage(pending, 0, 0, 2, 3)).toEqual(["TMP-4", "TMP-5", "TMP-6"]);
  });
});
