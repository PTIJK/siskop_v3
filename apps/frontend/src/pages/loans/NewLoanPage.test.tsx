import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewLoanPage } from "./NewLoanPage";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), page: vi.fn(), toast: vi.fn() }));
vi.mock("@/api/client", () => ({
  apiFetch: mocks.fetch, apiFetchPage: mocks.page, apiPost: vi.fn(), ApiRequestError: class extends Error {}
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

const summary = (id = "budi") => ({ id, memberId: `MEM-${id}`, fullName: `Anggota ${id}`, accountNumber: `ACC-${id}` });
const member = (id = "budi", savings: { savingConfig: { type: string }; isActive: boolean }[] = []) => ({ ...summary(id), savings });
const pokok = { savingConfig: { type: "POKOK" }, isActive: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function text(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === "string" ? child : text(child)).join("");
}

let view: ReactTestRenderer;
const button = (label: string) => view.root.findAllByType("button").find(node => text(node).trim() === label)!;
async function render(path = "/loans/new") {
  await act(async () => {
    view = create(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><NewLoanPage /></MemoryRouter>);
  });
}
async function select(id = "budi") {
  mocks.page.mockResolvedValueOnce({ items: [summary(id)], meta: { total: 1 } });
  await act(async () => { view.root.findByProps({ placeholder: "Cari nama anggota..." }).props.onChange({ target: { value: id } }); });
  await act(async () => { button(`Anggota ${id}MEM-${id}`).props.onClick(); });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/members/") ? member(path.split("/").pop()) : []);
});
afterEach(() => { if (view) act(() => view.unmount()); });

describe("loan member eligibility", () => {
  it("requires a member selection", async () => {
    await render();
    expect(button("Lanjut").props.disabled).toBe(true);
  });

  it("blocks continuation while the selected member is being checked", async () => {
    const pending = deferred<ReturnType<typeof member>>();
    mocks.fetch.mockImplementation((path: string) => path.startsWith("/members/") ? pending.promise : Promise.resolve([]));
    await render(); await select();
    expect(button("Lanjut").props.disabled).toBe(true);
  });

  it.each([
    { savings: [] },
    { savings: [{ ...pokok, isActive: false }] },
    { savings: [{ savingConfig: { type: "WAJIB" }, isActive: true }] }
  ])("blocks a member without an active principal savings account: %j", async ({ savings }) => {
    mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/members/") ? member("budi", savings) : []);
    await render(); await select();
    expect(text(view.root)).toContain("Belum memiliki simpanan pokok");
    expect(button("Lanjut").props.disabled).toBe(true);
  });

  it("keeps continuation blocked and shows a retry when the check fails", async () => {
    mocks.fetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/members/")) throw new Error("Network unavailable");
      return [];
    });
    await render(); await select();
    expect(button("Lanjut").props.disabled).toBe(true);
    expect(button("Coba lagi")).toBeDefined();
  });

  it("enables continuation after an active principal savings account is confirmed", async () => {
    mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/members/") ? member("budi", [pokok]) : []);
    await render(); await select();
    expect(button("Lanjut").props.disabled).toBe(false);
  });

  it("can recover from a failed lookup by explicitly retrying", async () => {
    let attempts = 0;
    mocks.fetch.mockImplementation(async (path: string) => {
      if (!path.startsWith("/members/")) return [];
      if (++attempts === 1) throw new Error("Network unavailable");
      return member("budi", [pokok]);
    });
    await render(); await select();
    await act(async () => { button("Coba lagi").props.onClick(); });
    expect(button("Lanjut").props.disabled).toBe(false);
    expect(attempts).toBe(2);
  });

  it("clears previous eligibility before checking a different selection", async () => {
    const pending = deferred<ReturnType<typeof member>>();
    mocks.fetch.mockImplementation((path: string) => path === "/members/new" ? pending.promise : Promise.resolve(path === "/members/budi" ? member("budi", [pokok]) : []));
    await render(); await select();
    expect(button("Lanjut").props.disabled).toBe(false);
    await act(async () => { button("Ganti").props.onClick(); });
    await select("new");
    expect(button("Lanjut").props.disabled).toBe(true);
  });

  it("applies the same restriction to a member supplied in the URL", async () => {
    await render("/loans/new?memberId=budi");
    expect(text(view.root)).toContain("Belum memiliki simpanan pokok");
    expect(button("Lanjut").props.disabled).toBe(true);
  });

  it("ignores an older eligible response after switching to an ineligible member", async () => {
    const old = deferred<ReturnType<typeof member>>();
    mocks.fetch.mockImplementation((path: string) => path === "/members/old" ? old.promise : Promise.resolve(path === "/members/new" ? member("new") : []));
    await render(); await select("old");
    await act(async () => { button("Ganti").props.onClick(); });
    await select("new");
    await act(async () => { old.resolve(member("old", [pokok])); });
    expect(text(view.root)).toContain("Anggota new");
    expect(text(view.root)).toContain("Belum memiliki simpanan pokok");
    expect(button("Lanjut").props.disabled).toBe(true);
  });

  it("starts a new check when manually selecting the member whose prefill is still pending", async () => {
    const prefill = deferred<ReturnType<typeof member>>();
    let attempts = 0;
    mocks.fetch.mockImplementation((path: string) => {
      if (!path.startsWith("/members/")) return Promise.resolve([]);
      return ++attempts === 1 ? prefill.promise : Promise.resolve(member());
    });
    await render("/loans/new?memberId=budi");
    await select();
    expect(text(view.root)).toContain("Belum memiliki simpanan pokok");
    await act(async () => { prefill.resolve(member("budi", [pokok])); });
    expect(button("Lanjut").props.disabled).toBe(true);
    expect(text(view.root)).toContain("Belum memiliki simpanan pokok");
  });
});
