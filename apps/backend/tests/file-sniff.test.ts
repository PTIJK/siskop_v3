import { describe, expect, it } from "vitest";
import { sniffFileType } from "../src/lib/file-sniff.js";

describe("sniffFileType", () => {
  it("identifies a JPEG by its magic bytes", () => {
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("jpg");
  });

  it("identifies a PNG by its magic bytes", () => {
    expect(sniffFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe("png");
  });

  it("identifies a PDF by its magic bytes", () => {
    expect(sniffFileType(Buffer.from("%PDF-1.4\n"))).toBe("pdf");
  });

  it("returns null for an unrecognized buffer, even one with a spoofed extension", () => {
    // e.g. an HTML/JS payload renamed foo.jpg — the declared filename/MIME
    // says image, the bytes say otherwise.
    expect(sniffFileType(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });

  it("returns null for a buffer shorter than the shortest signature", () => {
    expect(sniffFileType(Buffer.from([0xff]))).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });
});
