import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesCooperativeRegistry } from "@siskop/types";
import { lookupCooperative, parseOdsResult } from "../src/modules/onboarding/ods.js";

const row = `<tr><td>1</td><td><form method="post" action="detail">
  <input type="hidden" name="nik" value="internal-id">
  <button type="submit">Koperasi Contoh &amp; Mitra</button></form>
  <img src="images/icon_nbh.png"> 7615/BH/II/93<br></td></tr>`;

afterEach(() => vi.unstubAllGlobals());

describe("ODS cooperative lookup", () => {
  it("reads an unambiguous result and compares its legal identity", () => {
    const result = parseOdsResult(row);
    expect(result).toEqual({ detailId: "internal-id", name: "Koperasi Contoh & Mitra", registrationNo: "7615/BH/II/93" });
    expect(matchesCooperativeRegistry(result!, " KOPERASI CONTOH & MITRA ", "7615 / bh / II / 93")).toBe(true);
    expect(matchesCooperativeRegistry(result!, "Koperasi lain", "7615/BH/II/93")).toBe(false);
    expect(matchesCooperativeRegistry(result!, "Koperasi Contoh & Mitra", "7615/BH/II/94")).toBe(false);
    expect(parseOdsResult(row.repeat(2))).toBeNull();
  });

  it("posts the NIK and verifies the exact identifier in the detail record", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(`<input name="dcat" value="0000000000000">${row}`))
      .mockResolvedValueOnce(new Response("<table><tr><th>Nomor Induk Koperasi (NIK)</th><td>0000000000000</td></tr></table>"));
    vi.stubGlobal("fetch", fetch);
    await expect(lookupCooperative("0000000000000")).resolves.toEqual({
      name: "Koperasi Contoh & Mitra", registrationNo: "7615/BH/II/93"
    });
    expect(fetch.mock.calls[0]?.[1].body.toString()).toBe("dcat=0000000000000");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://nik.kop.go.id/odsnik/detail");
    expect(fetch.mock.calls[1]?.[1].body.toString()).toBe("nik=internal-id");
  });

  it.each([
    "<p>NIK Koperasi: 0000000000001</p>",
    "<p>Nomor badan hukum: 0000000000000</p>",
    '<input name="dcat" value="0000000000000">'
  ])("does not trust an echoed search or unrelated identifier", async (detail) => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(`<input name="dcat" value="0000000000000">${row}`))
      .mockResolvedValueOnce(new Response(detail)));
    await expect(lookupCooperative("0000000000000")).resolves.toBeNull();
  });

  it("reports an unavailable registry instead of a missing match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    await expect(lookupCooperative("0000000000000")).rejects.toThrow("ODS Koperasi unavailable");
  });
});
