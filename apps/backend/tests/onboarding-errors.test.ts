import { describe, expect, it } from "vitest";
import { duplicateRegistrationMessage } from "../src/modules/onboarding/service.js";

describe("duplicateRegistrationMessage", () => {
  it("returns natural Indonesian messages per unique constraint target", () => {
    expect(duplicateRegistrationMessage(["odsCooperativeNik"])).toContain("NIK koperasi");
    expect(duplicateRegistrationMessage(["registrationNo"])).toContain("Nomor badan hukum");
    expect(duplicateRegistrationMessage(["tenantId", "email"])).toContain("Email atau akun");
    expect(duplicateRegistrationMessage(["slug"])).toContain("Alamat workspace");
    expect(duplicateRegistrationMessage(undefined)).toContain("sudah terdaftar");
  });
});
