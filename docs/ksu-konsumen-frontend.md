# KSU Konsumen — Frontend Development Plan

> **Prereq:** Backend complete per `KSU-Konsumen-MVP-Development-Plan.md` — Product/SKU,
> Stock, POS, and PPOB-skeleton endpoints all live and tested.

**Goal:** Give a Toko (Konsumen) unit operator four screens — manage products, view/adjust
stock, run POS sales, and check/pay PPOB bills (against the stub) — reachable only from
within a unit that's `unitType: "KONSUMEN"`.

**Scope split from the earlier frontend plan:** the earlier plan's Units/Consolidated
Report/Member Statement pages are tenant-level (they show *across* units). These four
screens are unit-level — they only make sense once you're "inside" a specific Toko unit,
so routing nests under `/ksu/units/:unitId/...` rather than sitting at the top level.

**Tech stack:** same as before — React 18, TanStack Query, react-router-dom, Tailwind,
lucide-react. No new dependencies.

---

## Day 1: Product/SKU management + Stock management

**Files:**
- Modify: `apps/frontend/src/api/konsumen.ts` (new file)
- Create: `apps/frontend/src/pages/konsumen/ProductsPage.tsx`
- Create: `apps/frontend/src/pages/konsumen/StockPage.tsx`
- Create: `apps/frontend/src/components/konsumen/ProductRow.tsx`
- Create: `apps/frontend/src/components/konsumen/CreateProductDialog.tsx`
- Create: `apps/frontend/src/components/konsumen/StockMovementForm.tsx`
- Test: `apps/frontend/src/pages/konsumen/ProductsPage.test.tsx`

**Tasks:**

- [ ] Create `api/konsumen.ts` with typed wrappers:

```typescript
import { apiFetch } from "./client";

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  costPrice: string;
  sellPrice: string;
  unit: string;
  stockLevel: string;
}

export function getProducts(unitId: string) {
  return apiFetch<Product[]>(`/api/konsumen/products?unitId=${unitId}`);
}

export function createProduct(unitId: string, input: Omit<Product, "id" | "stockLevel">) {
  return apiFetch<Product>("/api/konsumen/products", { method: "POST", body: JSON.stringify({ unitId, ...input }) });
}

export function recordStockMovement(productId: string, input: { type: "IN" | "OUT" | "ADJUSTMENT"; quantity: number; reason: string }) {
  return apiFetch<void>(`/api/konsumen/products/${productId}/stock-movements`, { method: "POST", body: JSON.stringify(input) });
}
```

- [ ] Write the failing test for `ProductsPage`:

```tsx
test("renders product list with stock levels", async () => {
  vi.spyOn(konsumenApi, "getProducts").mockResolvedValue([
    { id: "1", sku: "BRG-001", name: "Beras 5kg", category: "Sembako", costPrice: "60000", sellPrice: "72000", unit: "pcs", stockLevel: "47" },
  ]);
  renderWithProviders(<ProductsPage unitId="unit-1" />);
  await waitFor(() => {
    expect(screen.getByText("Beras 5kg")).toBeInTheDocument();
    expect(screen.getByText("47 pcs")).toBeInTheDocument();
  });
});
```

- [ ] Run — expected FAIL.

- [ ] Implement `ProductRow.tsx` (SKU, name, category badge, sell price via `formatRupiah`,
      stock level with low-stock warning styling when `stockLevel < 10`):

```tsx
export function ProductRow({ product }: { product: Product }) {
  const lowStock = Number(product.stockLevel) < 10;
  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 text-sm text-slate-500">{product.sku}</td>
      <td className="py-2 font-medium text-slate-900">{product.name}</td>
      <td className="py-2 text-slate-700">{formatRupiah(product.sellPrice)}</td>
      <td className={`py-2 ${lowStock ? "text-[#D85A30] font-medium" : "text-slate-700"}`}>
        {product.stockLevel} {product.unit}
      </td>
    </tr>
  );
}
```

- [ ] Implement `CreateProductDialog.tsx` (same modal pattern as `CreateUnitDialog` from
      the earlier plan — SKU, name, category, cost price, sell price, unit fields, `useMutation`
      + `invalidateQueries(["konsumen-products", unitId])` on success).

- [ ] Implement `ProductsPage.tsx` — table of `ProductRow`s + "+ Tambah produk" button opening
      the dialog, scoped to `unitId` from route params.

- [ ] Run test — expected PASS.

- [ ] Commit: `git commit -m "feat(frontend): product/SKU management page"`

- [ ] Write failing test for `StockPage` (movement history table + a stock-in form).

- [ ] Implement `StockMovementForm.tsx` — product dropdown, type (`IN`/`ADJUSTMENT` only —
      `OUT` is system-generated from POS sales, not manually entered here), quantity, reason.
      Validate quantity > 0 before submit; show inline error if not.

- [ ] Implement `StockPage.tsx` — movement history table (date, product, type badge, quantity,
      reason) + the form above it.

- [ ] Run test — expected PASS.

- [ ] Commit: `git commit -m "feat(frontend): stock movement history and manual stock-in form"`

---

## Day 2: POS interface

**Files:**
- Modify: `apps/frontend/src/api/konsumen.ts` (add `createPOSSale`, `searchProducts`)
- Create: `apps/frontend/src/pages/konsumen/POSPage.tsx`
- Create: `apps/frontend/src/components/konsumen/ProductSearchGrid.tsx`
- Create: `apps/frontend/src/components/konsumen/POSCart.tsx`
- Test: `apps/frontend/src/pages/konsumen/POSPage.test.tsx`

This is the most interaction-heavy screen — client-side cart state (not server state, it's
ephemeral until checkout), so this is the one place `useState`/`useReducer` is correct
instead of TanStack Query.

**Tasks:**

- [ ] Add to `api/konsumen.ts`:

```typescript
export interface CartLine { productId: string; name: string; sellPrice: string; quantity: number; }

export function createPOSSale(unitId: string, input: { items: { productId: string; quantity: number }[]; paymentMethod: string; memberId?: string }) {
  return apiFetch<{ id: string; totalAmount: string }>("/api/konsumen/pos/sales", { method: "POST", body: JSON.stringify({ unitId, ...input }) });
}
```

- [ ] Write failing test — add two items to cart, verify running total, checkout calls the
      mutation with correct payload:

```tsx
test("adding items updates cart total, checkout submits correct payload", async () => {
  const createSpy = vi.spyOn(konsumenApi, "createPOSSale").mockResolvedValue({ id: "txn-1", totalAmount: "144000" });
  renderWithProviders(<POSPage unitId="unit-1" />);
  fireEvent.click(await screen.findByText("Beras 5kg")); // adds to cart
  fireEvent.click(screen.getByText("Beras 5kg")); // quantity 2
  expect(screen.getByText("Rp 144.000")).toBeInTheDocument(); // running total
  fireEvent.click(screen.getByText("Bayar"));
  await waitFor(() => {
    expect(createSpy).toHaveBeenCalledWith("unit-1", { items: [{ productId: "1", quantity: 2 }], paymentMethod: "CASH" });
  });
});
```

- [ ] Implement `ProductSearchGrid.tsx` — grid of tappable product tiles (name, price), filtered
      by a search input; tapping a tile adds/increments it in the cart.

- [ ] Implement `POSCart.tsx` — line items with quantity +/- controls, remove button, running
      total via `formatRupiah`, payment method selector (`CASH`/`TRANSFER`/`MEMBER_CREDIT`),
      "Bayar" button. Disable "Bayar" with an inline message if cart is empty — don't let an
      empty checkout submit.

- [ ] Implement `POSPage.tsx` — holds cart state (`useReducer`: `ADD_ITEM`, `REMOVE_ITEM`,
      `SET_QUANTITY`, `CLEAR`), renders `ProductSearchGrid` + `POSCart` side by side, on
      successful checkout clears the cart and shows a receipt summary (transaction id, total).

- [ ] Run test — expected PASS.

- [ ] Manual verify against the seeded demo tenant: complete one real sale, confirm the
      Products page reflects the reduced stock level afterward (cross-check with Day 1's page).

- [ ] Commit: `git commit -m "feat(frontend): POS sale interface with cart state and checkout"`

---

## Day 3: PPOB screen + routing/nav + regression

**Files:**
- Modify: `apps/frontend/src/api/konsumen.ts` (add `checkPPOBBill`, `payPPOBBill`)
- Create: `apps/frontend/src/pages/konsumen/PPOBPage.tsx`
- Modify: router config (nest Konsumen unit routes)
- Modify: nav/sidebar component
- Test: `apps/frontend/src/pages/konsumen/PPOBPage.test.tsx`
- Test: routing gate test (extend the one from the earlier plan)

**Tasks:**

- [ ] Add to `api/konsumen.ts`:

```typescript
export function checkPPOBBill(unitId: string, input: { billType: string; customerNumber: string }) {
  return apiFetch<{ amount: string; customerName: string; adminFee: string }>("/api/konsumen/ppob/check", { method: "POST", body: JSON.stringify({ unitId, ...input }) });
}
export function payPPOBBill(unitId: string, input: { billType: string; customerNumber: string; adminFee: string }) {
  return apiFetch<{ id: string; status: string }>("/api/konsumen/ppob/pay", { method: "POST", body: JSON.stringify({ unitId, ...input }) });
}
```

- [ ] Write failing test — check bill shows amount + customer name, pay button only enabled
      after a successful check, error state shown if check fails:

```tsx
test("pay button disabled until bill check succeeds", async () => {
  renderWithProviders(<PPOBPage unitId="unit-1" />);
  expect(screen.getByText("Bayar tagihan")).toBeDisabled();

  vi.spyOn(konsumenApi, "checkPPOBBill").mockResolvedValue({ amount: "150000", adminFee: "2500", customerName: "Pelanggan Demo" });
  fireEvent.change(screen.getByPlaceholderText("Nomor pelanggan"), { target: { value: "1234567890" } });
  fireEvent.click(screen.getByText("Cek tagihan"));

  await waitFor(() => expect(screen.getByText("Pelanggan Demo")).toBeInTheDocument());
  expect(screen.getByText("Bayar tagihan")).not.toBeDisabled();
});
```

- [ ] Implement `PPOBPage.tsx` — bill type select (`LISTRIK`/`PULSA`/`BPJS`/`AIR`), customer
      number input, "Cek tagihan" button → shows amount/admin fee/customer name on success or
      an inline error on failure, "Bayar tagihan" button disabled until check succeeds.
      Add a small visible note near the top: "Menggunakan penyedia simulasi — integrasi
      penyedia riil akan ditambahkan kemudian" so it's clear to any operator testing this
      that it's not a live biller yet.

- [ ] Run test — expected PASS.

- [ ] Commit: `git commit -m "feat(frontend): PPOB check-and-pay screen against stub provider"`

- [ ] **Routing:** nest these four screens under the unit, gated on the unit's `unitType`:

```tsx
<Route path="/ksu/units/:unitId" element={<UnitLayout />}>
  {unit.unitType === "KONSUMEN" && (
    <>
      <Route path="products" element={<ProductsPage />} />
      <Route path="stock" element={<StockPage />} />
      <Route path="pos" element={<POSPage />} />
      <Route path="ppob" element={<PPOBPage />} />
    </>
  )}
</Route>
```

- [ ] Extend the routing gate test: a KSP-type unit's page shows none of these four links; a
      KONSUMEN-type unit's page shows all four.

- [ ] Update nav — inside a unit's detail view, show "Produk," "Stok," "POS," "PPOB" tabs
      only when that specific unit is `KONSUMEN` type (this is a per-unit gate, distinct from
      the tenant-level `isMultiUnit` gate from the earlier plan — a KSU tenant with a KSP unit
      and a Toko unit shows different tabs depending on which unit you're viewing).

- [ ] **Full regression:** `pnpm --filter @siskop/frontend test` — 100% pass, no existing
      test file modified.

- [ ] Manual verify: navigate to the KSP unit inside the demo tenant, confirm none of the
      four Konsumen tabs appear; navigate to the Toko unit, confirm all four appear and work
      against real seeded data.

- [ ] Commit: `git commit -m "feat(frontend): gate Konsumen screens on per-unit type"`

---

## End-of-plan acceptance checklist

- [ ] Products page lists SKUs with live stock levels and a low-stock visual flag
- [ ] Stock page shows movement history and supports manual stock-in / adjustment
- [ ] POS page supports a full cart → checkout flow, reduces stock, and reflects instantly
      on the Products page
- [ ] PPOB page checks and pays a bill end-to-end against the stub, with a visible
      "simulation provider" notice
- [ ] All four screens are reachable only from within a `KONSUMEN`-type unit — a KSP unit
      shows none of them
- [ ] Full existing frontend test suite passes unmodified
