import { describe, expect, it } from "vitest";
import { checkVerifiedMemberBatch } from "../src/modules/migration/kopkar-verified-members.js";

const source = [
  { sourceRow: 4, temporaryId: "TMP-0001", fullName: "Dwi Sumber" },
  { sourceRow: 5, temporaryId: "TMP-SRC-0100", fullName: "Rina Sumber" },
  { sourceRow: 6, temporaryId: "TMP-SRC-0101", fullName: "Rina Sumber" }
];
const identity = {
  fullName: "Dwi Sumber", nik: "3578012345670001", address: "Jl. Contoh No. 10",
  birthPlace: "Surabaya", birthDate: "1980-06-15", occupation: "Pegawai"
};
const existing = [
  { id: "m-1", memberId: "KOP-UJI-0001", nik: "3578012345670002", fullName: "Rina Sumber", isActive: true },
  { id: "m-2", memberId: "KOP-UJI-0002", nik: "3578012345670003", fullName: "Rina Sumber", isActive: false }
];

describe("verified RAT member batch checks", () => {
  it("distinguishes creating a verified member from explicitly linking an active member", () => {
    const result = checkVerifiedMemberBatch([
      { sourceRow: 4, action: "create", identity },
      { sourceRow: 5, action: "link", memberId: "m-1", verifiedNik: "3578012345670002" }
    ], source, existing);
    expect(result).toMatchObject({
      canPublish: true, issues: [],
      rows: [
        { sourceRow: 4, temporaryId: "TMP-0001", fullName: "Dwi Sumber", action: "create" },
        { sourceRow: 5, temporaryId: "TMP-SRC-0100", fullName: "Rina Sumber", action: "link", linkedMemberNumber: "KOP-UJI-0001" }
      ]
    });
    expect(JSON.stringify(result)).not.toContain("357801234567000");
  });

  it("rejects placeholders, invalid dates, duplicate source rows, unknown rows and mismatched identities", () => {
    const result = checkVerifiedMemberBatch([
      { sourceRow: 4, action: "create", identity: { ...identity, nik: "TMP-0001", birthDate: "2025-02-29" } },
      { sourceRow: 4, action: "create", identity },
      { sourceRow: 5, action: "link", memberId: "m-1", verifiedNik: "3578012345670999" },
      { sourceRow: 6, action: "link", memberId: "m-2", verifiedNik: "3578012345670003" },
      { sourceRow: 7, action: "create", identity }
    ], source, existing);
    expect(result.canPublish).toBe(false);
    expect(result.issues.map(({ sourceRow, field }) => [sourceRow, field])).toEqual([
      [4, "nik"], [4, "birthDate"], [4, "sourceRow"], [5, "verifiedNik"], [6, "memberId"], [7, "sourceRow"]
    ]);
  });

  it("requires one source row per verified NIK and never creates over an existing NIK", () => {
    const result = checkVerifiedMemberBatch([
      { sourceRow: 4, action: "create", identity: { ...identity, nik: existing[0]!.nik } },
      { sourceRow: 5, action: "create", identity },
      { sourceRow: 6, action: "create", identity }
    ], source, existing);
    expect(result.canPublish).toBe(false);
    expect(result.issues.map(({ sourceRow, field }) => [sourceRow, field])).toEqual([[4, "nik"], [6, "nik"]]);
    expect(checkVerifiedMemberBatch([], source, existing).canPublish).toBe(false);
  });
});
