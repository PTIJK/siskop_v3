import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpHint } from "@/components/shared/HelpHint";

describe("HelpHint", () => {
  it("renders only a small labelled button; the help text stays hidden until opened", () => {
    const html = renderToString(<HelpHint>Teks bantuan panjang</HelpHint>);
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Bantuan"');
    expect(html).not.toContain("Teks bantuan panjang");
  });

  it("uses a custom accessible label", () => {
    const html = renderToString(<HelpHint label="Bantuan template">x</HelpHint>);
    expect(html).toContain('aria-label="Bantuan template"');
  });

  it("is a type=button so it never submits a surrounding form", () => {
    expect(renderToString(<HelpHint>x</HelpHint>)).toContain('type="button"');
  });
});
