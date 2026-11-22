import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShuDistribusiTab } from "../../../../../mobile/src/pages/reports/regulatory/ShuDistribusiTab";

const mocks = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock("@/api/client", () => ({ apiFetchPage: mocks.page, ApiRequestError: class extends Error {} }));
vi.mock("@/lib/format", () => ({ formatRupiahSingkat: (value: string) => value }));
vi.mock("@/components/shared/EntitlementNotice", () => ({ EntitlementNotice: () => null }));
vi.mock("@/components/shared/LoadingSpinner", () => ({ PageLoading: () => null }));

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}
let view: ReactTestRenderer;
afterEach(() => { if (view) act(() => view.unmount()); vi.clearAllMocks(); });

describe("mobile SHU report pagination", () => {
  it("loads the next page for the displayed period", async () => {
    mocks.page.mockImplementation(async (path: string) => {
      const query = new URLSearchParams(path.split("?")[1]);
      const page = Number(query.get("page"));
      return { items: { periode: { from: query.get("from"), to: query.get("to") }, shuBerjalan: "100", alokasi: null,
        anggota: [{ no: page, memberId: `member-${page}`, memberCode: `M-${page}`, fullName: `Member ${page}`,
          shuPokokWajib: "1", shuSukarela: "0", jasaPinjaman: "0", totalShu: "1" }], totalDibagikanKeAnggota: "100" },
        meta: { page, limit: 15, total: 30 } };
    });
    await act(async () => { view = create(<ShuDistribusiTab />); });
    const first = new URLSearchParams(mocks.page.mock.calls[0]![0].split("?")[1]);
    expect(first.get("page")).toBe("1");
    expect(first.get("limit")).toBe("15");
    expect(text(view.root)).toContain("Member 1");
    await act(async () => { view.root.findAllByType("input")[0]!.props.onChange({ target: { value: "2020-01-01" } }); });
    await act(async () => { view.root.findByProps({ "aria-label": "Halaman berikutnya" }).props.onClick(); });
    const second = new URLSearchParams(mocks.page.mock.calls[1]![0].split("?")[1]);
    expect(second.get("page")).toBe("2");
    expect(second.get("from")).toBe(first.get("from"));
    expect(second.get("to")).toBe(first.get("to"));
    expect(text(view.root)).toContain("Member 2");
    expect(text(view.root)).toContain("30 anggota");
  });
});
