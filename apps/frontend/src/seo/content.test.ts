import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFINITION, FAQS, LAST_UPDATED, PAGE_DESCRIPTION, PAGE_TITLE, words } from "./content";

describe("landing SEO content", () => {
  it("keeps title and description inside the recommended length", () => {
    expect(PAGE_TITLE.length).toBeGreaterThanOrEqual(50);
    expect(PAGE_TITLE.length).toBeLessThanOrEqual(60);
    expect(PAGE_DESCRIPTION.length).toBeGreaterThanOrEqual(150);
    expect(PAGE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });
  it("answers 'what is SISKOP' in 40-60 words", () => {
    expect(words(DEFINITION)).toBeGreaterThanOrEqual(40);
    expect(words(DEFINITION)).toBeLessThanOrEqual(60);
  });
  it("has 6-8 FAQs with short, unique answers", () => {
    expect(FAQS.length).toBeGreaterThanOrEqual(6);
    expect(FAQS.length).toBeLessThanOrEqual(8);
    for (const { question, answer } of FAQS) {
      expect(question.endsWith("?")).toBe(true);
      expect(words(answer)).toBeLessThanOrEqual(60);
    }
    expect(new Set(FAQS.map((f) => f.question)).size).toBe(FAQS.length);
  });
  it("uses an ISO last-updated date", () => {
    expect(LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("has index.html declare Indonesian and the seo placeholders", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(html).toContain('<html lang="id">');
    expect(html).toContain("<!--seo-head-->");
  });
});
