import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShuDistribusiTab } from "./ShuDistribusiTab";

const mocks = vi.hoisted(() => ({ page: vi.fn(), toast: vi.fn() }));
vi.mock("@/api/client", () => ({ apiFetchPage: mocks.page, ApiRequestError: class extends Error {} }));
vi.mock("@/stores/auth", () => ({ useAuth: () => ({ user: null }), getAccessToken: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => false }) }));

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}
let view: ReactTestRenderer;
afterEach(() => { if (view) act(() => view.unmount()); vi.clearAllMocks(); });

describe("SHU report pagination", () => {
  it("loads pages for the applied period and preserves the full report total", async () => {
    mocks.page.mockImplementation(async (path: string) => {
      const query = new URLSearchParams(path.split("?")[1]);
      const page = Number(query.get("page"));
      return {
        items: { periode: { from: query.get("from"), to: query.get("to") }, shuBerjalan: "100", alokasi: null,
          anggota: [{ no: page, memberId: `member-${page}`, memberCode: `M-${page}`, fullName: `Member ${page}`,
            shuPokokWajib: "1", shuSukarela: "0", jasaPinjaman: "0", totalShu: "1" }], totalDibagikanKeAnggota: "100" },
        meta: { page, limit: 50, total: 100 }
      };
    });
    await act(async () => { view = create(<MemoryRouter><ShuDistribusiTab /></MemoryRouter>); });
    const button = (label: string) => view.root.findAllByType("button").find((node) => text(node).trim().includes(label))!;
    await act(async () => { button("Tampilkan").props.onClick(); });
    const first = new URLSearchParams(mocks.page.mock.calls[0]![0].split("?")[1]);
    expect(first.get("page")).toBe("1");
    expect(first.get("limit")).toBe("50");
    expect(text(view.root)).toContain("Member 1");
    expect(text(view.root)).toContain("Total Dibagikan ke Anggota");
    await act(async () => { view.root.findAllByType("input").find((input) => input.props.type === "date")!.props.onChange({ target: { value: "2020-01-01" } }); });
    mocks.page.mockRejectedValueOnce(new Error("network error"));
    await act(async () => { button("Tampilkan").props.onClick(); });
    await act(async () => { button("Berikutnya").props.onClick(); });
    const second = new URLSearchParams(mocks.page.mock.calls[2]![0].split("?")[1]);
    expect(second.get("page")).toBe("2");
    expect(second.get("from")).toBe(first.get("from"));
    expect(second.get("to")).toBe(first.get("to"));
    expect(text(view.root)).toContain("Member 2");
  });
});
