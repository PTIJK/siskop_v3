import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BookOpenCheck,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  Package as PackageIcon,
  PieChart,
  PiggyBank,
  Receipt,
  Settings,
  ShieldCheck,
  Store,
  Tags,
  UserPlus,
  Users,
  Wallet,
  Warehouse,
  ArrowLeftRight,
  Gauge,
  FileSpreadsheet,
  ScrollText,
  ShoppingCart
} from "lucide-react";
import type { PermissionAction, PermissionModule } from "@siskop/types";

export type NavGroupId = "harian" | "anggota" | "keuangan" | "laporan" | "pengaturan" | "platform";

export interface NavEntry {
  /** Stable key, also used by the command palette. */
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** Hidden unless the role has this permission. */
  permission?: { module: PermissionModule; action: PermissionAction };
  /** Any one of these permissions is enough (used by Pengaturan). */
  anyPermission?: readonly { module: PermissionModule; action: PermissionAction }[];
  /** Pricing V2 feature key; locked (not hidden) when the package lacks it. */
  feature?: string;
  /** Only for tenants with more than one unit. */
  requiresMultiUnit?: boolean;
  /** Extra words the palette should match. */
  keywords?: string;
}

export const NAV_GROUP_LABEL: Record<NavGroupId, string> = {
  harian: "Harian",
  anggota: "Anggota",
  keuangan: "Keuangan",
  laporan: "Laporan",
  pengaturan: "Pengaturan",
  platform: "Platform Admin"
};

export const NAV_GROUP_ORDER: readonly NavGroupId[] = ["harian", "anggota", "keuangan", "laporan", "pengaturan"];

// Every route that had a sidebar entry before the redesign is still listed here, just regrouped by task.
export const TENANT_NAV: readonly NavEntry[] = [
  { id: "beranda", label: "Beranda", href: "/dashboard", icon: LayoutDashboard, group: "harian", permission: { module: "dashboard", action: "read" }, keywords: "dashboard ringkasan" },
  { id: "setor", label: "Setor dan tarik", href: "/savings/new", icon: ArrowLeftRight, group: "harian", permission: { module: "savings", action: "create" }, keywords: "setoran penarikan simpanan transaksi" },
  { id: "kasir", label: "Kasir toko", href: "/ksu/toko", icon: Store, group: "harian", permission: { module: "konsumen", action: "read" }, feature: "unit_konsumen", keywords: "pos toko penjualan" },

  { id: "anggota", label: "Daftar anggota", href: "/members", icon: Users, group: "anggota", permission: { module: "members", action: "read" }, keywords: "member nik" },
  { id: "simpanan", label: "Simpanan", href: "/savings", icon: PiggyBank, group: "anggota", permission: { module: "savings", action: "read" }, keywords: "rekening saldo" },
  { id: "pinjaman", label: "Pinjaman", href: "/loans", icon: CreditCard, group: "anggota", permission: { module: "loans", action: "read" }, keywords: "kredit angsuran" },
  { id: "pinjaman-baru", label: "Pinjaman baru", href: "/loans/new", icon: UserPlus, group: "anggota", permission: { module: "loans", action: "create" }, keywords: "ajukan kredit" },
  { id: "menunggak", label: "Anggota menunggak", href: "/loans/overdue", icon: AlertTriangle, group: "anggota", permission: { module: "loans", action: "read" }, keywords: "tunggakan terlambat kol" },
  { id: "pasar", label: "Koperasi Pasar", href: "/market", icon: Warehouse, group: "anggota", permission: { module: "market", action: "read" }, feature: "unit_pasar", keywords: "pedagang kolektor" },

  { id: "piutang", label: "Piutang anggota", href: "/piutang", icon: Receipt, group: "keuangan", permission: { module: "konsumen", action: "read" }, feature: "member_receivables", keywords: "kredit toko" },
  { id: "beban", label: "Beban umum", href: "/expenses", icon: Wallet, group: "keuangan", permission: { module: "expenses", action: "read" }, keywords: "biaya pengeluaran" },
  { id: "jurnal", label: "Jurnal manual", href: "/journal/new", icon: ScrollText, group: "keuangan", permission: { module: "reports", action: "read" }, feature: "manual_journal", keywords: "jurnal" },
  { id: "tutup-buku", label: "Tutup buku", href: "/journal/close", icon: BookOpenCheck, group: "keuangan", permission: { module: "reports", action: "read" }, feature: "period_closing", keywords: "tutup tahun periode" },

  { id: "laporan", label: "Laporan keuangan", href: "/reports", icon: FileText, group: "laporan", permission: { module: "reports", action: "read" }, feature: "reports_financial", keywords: "neraca laba rugi" },
  { id: "regulasi", label: "Laporan regulasi", href: "/reports/regulatory", icon: FileSpreadsheet, group: "laporan", permission: { module: "reports", action: "read" }, feature: "reports_regulatory", keywords: "shu calk arus kas" },
  { id: "buku", label: "Buku akuntansi", href: "/reports/accounting", icon: BookOpenCheck, group: "laporan", permission: { module: "reports", action: "read" }, feature: "accounting_book", keywords: "buku besar jurnal neraca saldo" },
  { id: "portofolio", label: "Kualitas portofolio", href: "/reports/portfolio", icon: Gauge, group: "laporan", permission: { module: "reports", action: "read" }, feature: "portfolio_quality", keywords: "kol npl par" },
  { id: "laporan-pasar", label: "Laporan pasar", href: "/reports/pasar", icon: ShoppingCart, group: "laporan", permission: { module: "reports", action: "read" }, feature: "reports_market" },
  { id: "konsolidasi", label: "Laporan konsolidasi", href: "/ksu/report", icon: PieChart, group: "laporan", permission: { module: "reports", action: "read" }, feature: "reports_consolidated", requiresMultiUnit: true, keywords: "unit usaha ksu" },

  { id: "langganan", label: "Langganan", href: "/langganan", icon: PackageIcon, group: "pengaturan", keywords: "paket tagihan faktur kuota" },
  {
    id: "pengaturan",
    label: "Pengaturan",
    href: "/config",
    icon: Settings,
    group: "pengaturan",
    anyPermission: [
      { module: "config", action: "read" },
      { module: "roles", action: "read" },
      { module: "accounting", action: "read" }
    ],
    keywords: "konfigurasi peran unit akun"
  }
];

export const PLATFORM_NAV: readonly NavEntry[] = [
  { id: "p-dashboard", label: "Dashboard", href: "/platform/dashboard", icon: Gauge, group: "platform" },
  { id: "p-tenants", label: "Koperasi", href: "/platform/tenants", icon: Landmark, group: "platform" },
  { id: "p-packages", label: "Paket langganan", href: "/platform/packages", icon: PackageIcon, group: "platform" },
  { id: "p-pricing", label: "Harga dan paket", href: "/platform/pricing", icon: Tags, group: "platform" },
  { id: "p-invoices", label: "Faktur", href: "/platform/invoices", icon: Receipt, group: "platform" },
  { id: "p-admins", label: "Admin platform", href: "/platform/admins", icon: ShieldCheck, group: "platform" }
];

export interface NavContext {
  isPlatformAdmin: boolean;
  isMultiUnit: boolean;
  can: (module: PermissionModule, action: PermissionAction) => boolean;
  isLocked: (feature: string) => boolean;
}

export interface ResolvedNavEntry extends NavEntry {
  /** Where the link actually goes: the feature's own route, or the Langganan page when locked. */
  to: string;
  locked: boolean;
}

export interface NavSection {
  group: NavGroupId;
  label: string;
  items: ResolvedNavEntry[];
}

function allowed(entry: NavEntry, ctx: NavContext): boolean {
  if (entry.requiresMultiUnit && !ctx.isMultiUnit) return false;
  if (entry.permission && !ctx.can(entry.permission.module, entry.permission.action)) return false;
  if (entry.anyPermission && !entry.anyPermission.some((p) => ctx.can(p.module, p.action))) return false;
  return true;
}

function resolve(entry: NavEntry, ctx: NavContext): ResolvedNavEntry {
  const locked = entry.feature !== undefined && ctx.isLocked(entry.feature);
  return { ...entry, locked, to: locked ? `/langganan?fitur=${entry.feature}` : entry.href };
}

/**
 * What this user sees in the sidebar and the command palette. A missing role
 * permission removes the entry; a missing package feature keeps it, locked
 * (design.md §7.1). Platform admins only get the platform group.
 */
export function buildNav(ctx: NavContext): NavSection[] {
  if (ctx.isPlatformAdmin) {
    return [{ group: "platform", label: NAV_GROUP_LABEL.platform, items: PLATFORM_NAV.map((e) => resolve(e, ctx)) }];
  }
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    label: NAV_GROUP_LABEL[group],
    items: TENANT_NAV.filter((e) => e.group === group && allowed(e, ctx)).map((e) => resolve(e, ctx))
  })).filter((section) => section.items.length > 0);
}

export interface QuickAction {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Quick actions by what the role can do, most relevant first (design.md §7.2).
 * A cashier (store only) leads with a new sale, a manager with a new member,
 * a teller with a deposit. Capped at five.
 */
export function buildQuickActions(ctx: Pick<NavContext, "can" | "isPlatformAdmin">): QuickAction[] {
  if (ctx.isPlatformAdmin) return [];
  const setor: QuickAction = { id: "qa-setor", label: "Setor simpanan", href: "/savings/new", icon: PiggyBank };
  const pinjaman: QuickAction = { id: "qa-pinjaman", label: "Pinjaman baru", href: "/loans/new", icon: CreditCard };
  const anggota: QuickAction = { id: "qa-anggota", label: "Anggota baru", href: "/members/new", icon: UserPlus };
  const kasir: QuickAction = { id: "qa-kasir", label: "Transaksi baru", href: "/ksu/toko", icon: Store };

  const canSetor = ctx.can("savings", "create");
  const canPinjaman = ctx.can("loans", "create");
  const canAnggota = ctx.can("members", "create");
  const canKasir = ctx.can("konsumen", "create");
  const isManager = ctx.can("config", "read") && canAnggota;

  const ordered: QuickAction[] = [];
  if (canKasir && !canSetor && !canAnggota && !canPinjaman) ordered.push(kasir);
  else if (isManager) ordered.push(anggota, setor, pinjaman, kasir);
  else ordered.push(setor, anggota, pinjaman, kasir);

  const available = ordered.filter((a) => {
    if (a === setor) return canSetor;
    if (a === pinjaman) return canPinjaman;
    if (a === anggota) return canAnggota;
    return canKasir;
  });
  return available.slice(0, 5);
}

/** Palette matching: every word typed must appear in the label or keywords (case-insensitive). */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
