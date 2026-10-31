import { describe, expect, it } from "vitest";
import type { MigrationPreview } from "@siskop/types";
import { canExecuteMigration, isPreviewStale } from "./destination";

const preview = (over: Partial<MigrationPreview> = {}): MigrationPreview => ({
  mode: "SISTEM",
  target: null,
  fileHash: "a".repeat(64),
  tenantName: "Koperasi Uji",
  slug: "koperasi-uji",
  cutoffDate: "2025-12-31",
  counts: [],
  totals: null,
  openingEntry: [],
  issues: [],
  canExecute: true,
  ...over
});
const target = { tenantId: "t1", name: "Koperasi Uji", slug: "koperasi-uji" };

describe("isPreviewStale", () => {
  it("is fresh for a new koperasi when the preview has no target", () => {
    expect(isPreviewStale(preview(), "baru", null)).toBe(false);
  });

  it("is stale for a new koperasi when the preview still carries a target", () => {
    expect(isPreviewStale(preview({ target }), "baru", null)).toBe(true);
  });

  it("is stale for an existing koperasi until one is chosen", () => {
    expect(isPreviewStale(preview(), "ada", null)).toBe(true);
  });

  it("is stale when the preview was made for a different koperasi than the chosen one", () => {
    expect(isPreviewStale(preview({ target }), "ada", "t2")).toBe(true);
  });

  it("is fresh when the preview target matches the chosen koperasi", () => {
    expect(isPreviewStale(preview({ target }), "ada", "t1")).toBe(false);
  });
});

describe("canExecuteMigration", () => {
  it("needs a clean, fresh preview", () => {
    expect(canExecuteMigration(preview(), "baru", null)).toBe(true);
    expect(canExecuteMigration(preview({ canExecute: false }), "baru", null)).toBe(false);
  });

  it("is blocked while the preview is stale, even if it was clean", () => {
    expect(canExecuteMigration(preview(), "ada", null)).toBe(false);
    expect(canExecuteMigration(preview({ target }), "ada", "t2")).toBe(false);
  });

  it("is allowed for a matching existing koperasi with a clean preview", () => {
    expect(canExecuteMigration(preview({ target }), "ada", "t1")).toBe(true);
  });
});
