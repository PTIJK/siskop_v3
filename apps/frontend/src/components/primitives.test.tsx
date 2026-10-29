import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { QuotaMeter } from "@/components/shared/QuotaMeter";
import { Stepper } from "@/components/shared/Stepper";
import { GlossaryTerm } from "@/components/shared/GlossaryTerm";
import { LockedFeature } from "@/components/shared/LockedFeature";
import { EmptyState } from "@/components/shared/EmptyState";

describe("MoneyInput", () => {
  it("shows the stored digits grouped with dots", () => {
    const html = renderToString(<MoneyInput value="1250000" onValueChange={() => {}} aria-label="Nominal" />);
    expect(html).toContain('value="1.250.000"');
    expect(html).toContain('inputMode="numeric"');
  });

  it("renders quick amounts as a labelled group", () => {
    const html = renderToString(<MoneyInput value="50000" onValueChange={() => {}} quickAmounts={[50000, 100000]} />);
    expect(html).toContain('aria-label="Nominal cepat"');
    expect(html).toContain("100.000");
  });

  it("announces an inline error with the field marked invalid", () => {
    const html = renderToString(<MoneyInput value="" onValueChange={() => {}} error="Saldo tidak cukup" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Saldo tidak cukup");
    expect(html).toContain('aria-invalid="true"');
  });

  it("is not editable when disabled", () => {
    const html = renderToString(<MoneyInput value="" onValueChange={() => {}} disabled />);
    expect(html).toContain("disabled");
  });
});

describe("Button", () => {
  it("blocks clicks and reports busy while loading", () => {
    const html = renderToString(<Button loading>Posting</Button>);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("status shown without colour alone", () => {
  it("Badge status variants include a marker plus text", () => {
    const html = renderToString(<Badge variant="warn">Menunggu</Badge>);
    expect(html).toContain("Menunggu");
    expect(html).toContain('aria-hidden="true"');
  });

  it("KOLBadge writes the level number and name", () => {
    expect(renderToString(<KOLBadge category="LANCAR" />)).toContain("KOL 1 Lancar");
    expect(renderToString(<KOLBadge category="MACET" />)).toContain("KOL 5 Macet");
    expect(renderToString(<KOLBadge category="TIDAK_DIKENAL" />)).toContain("TIDAK_DIKENAL");
  });
});

describe("QuotaMeter", () => {
  it("exposes role=meter with numeric values and words near the cap", () => {
    const html = renderToString(<QuotaMeter label="Anggota aktif" used={46} limit={50} />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="46"');
    expect(html).toContain('aria-valuemax="50"');
    expect(html).toContain("Hampir penuh");
  });

  it("says full at the limit and over beyond it", () => {
    expect(renderToString(<QuotaMeter label="Pengguna" used={5} limit={5} />)).toContain("Penuh");
    expect(renderToString(<QuotaMeter label="Pengguna" used={7} limit={5} />)).toContain("Melebihi batas");
  });

  it("has no bar for an unlimited package", () => {
    const html = renderToString(<QuotaMeter label="Anggota aktif" used={12} limit={null} />);
    expect(html).not.toContain('role="meter"');
    expect(html).toContain("tanpa batas");
  });
});

describe("Stepper", () => {
  it("marks only the active step with aria-current=step", () => {
    const html = renderToString(<Stepper steps={["Anggota", "Produk", "Jadwal", "Tinjau"]} current={1} />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("(selesai)");
  });
});

describe("GlossaryTerm", () => {
  it("is keyboard reachable and describes itself with a tooltip", () => {
    const html = renderToString(<GlossaryTerm term="SHU" />);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Sisa Hasil Usaha");
  });
});

describe("LockedFeature", () => {
  it("offers the way forward and never a dead end", () => {
    const html = renderToString(
      <StaticRouter location="/market">
        <LockedFeature featureName="Koperasi Pasar" packageName="Tumbuh" unlockedBy={["Usaha"]} />
      </StaticRouter>
    );
    expect(html).toContain("Koperasi Pasar belum termasuk di paket Tumbuh");
    expect(html).toContain('href="/langganan"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Tersedia di paket Usaha");
  });
});

describe("EmptyState", () => {
  it("teaches the next step", () => {
    const html = renderToString(<EmptyState title="Belum ada anggota" description="Tambah anggota pertama untuk mulai." />);
    expect(html).toContain("Belum ada anggota");
    expect(html).toContain("Tambah anggota pertama");
  });
});
