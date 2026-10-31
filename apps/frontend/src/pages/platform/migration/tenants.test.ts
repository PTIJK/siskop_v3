import { describe, expect, it } from "vitest";
import { filterTenants, type TenantOption } from "./tenants";

const t = (name: string, slug: string, registrationNo = "AHU-1", isActive = true): TenantOption => ({ id: slug, name, slug, registrationNo, isActive });
const LIST = [
  t("Koperasi Maju Jaya", "maju-jaya"),
  t("KSP Barokah", "barokah", "AHU-22"),
  t("Kopkar UM Surabaya", "kopkar-um", "AHU-33", false),
  t("Koperasi Sejahtera", "sejahtera")
];

describe("filterTenants", () => {
  it("returns everything sorted by name for an empty query", () => {
    expect(filterTenants(LIST, "").map((x) => x.name)).toEqual(["Koperasi Maju Jaya", "Koperasi Sejahtera", "Kopkar UM Surabaya", "KSP Barokah"]);
  });

  it("matches name, slug and registration number, ignoring case", () => {
    expect(filterTenants(LIST, "BAROKAH").map((x) => x.slug)).toEqual(["barokah"]);
    expect(filterTenants(LIST, "kopkar-um").map((x) => x.slug)).toEqual(["kopkar-um"]);
    expect(filterTenants(LIST, "ahu-22").map((x) => x.slug)).toEqual(["barokah"]);
  });

  it("requires every word to match (any order)", () => {
    expect(filterTenants(LIST, "jaya koperasi").map((x) => x.slug)).toEqual(["maju-jaya"]);
  });

  it("ranks names that start with the query first", () => {
    expect(filterTenants(LIST, "kop").map((x) => x.slug)).toEqual(["maju-jaya", "sejahtera", "kopkar-um"]);
  });

  it("returns nothing when no word matches", () => {
    expect(filterTenants(LIST, "zzz")).toEqual([]);
  });

  it("trims surrounding whitespace", () => {
    expect(filterTenants(LIST, "  barokah  ")).toHaveLength(1);
  });
});
