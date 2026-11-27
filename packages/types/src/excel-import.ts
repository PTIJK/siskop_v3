export const EXCEL_IMPORT_GROUPS = ["anggota", "simpanan", "pinjaman", "neraca", "kas", "lainnya"] as const;
export type ExcelImportGroup = (typeof EXCEL_IMPORT_GROUPS)[number];

export type ExcelImportField = { label: string; value: string | number; kind: "text" | "money" | "nik" };

export type ExcelImportRecord = {
  title: string;
  memberName?: string;
  sheet: string;
  fields: ExcelImportField[];
  notes: string[];
};

export type ExcelImportData = Record<ExcelImportGroup, ExcelImportRecord[]>;

export type ExcelImportSummary = {
  id: string;
  fileName: string;
  createdAt: string;
  counts: Record<ExcelImportGroup, number>;
  limited: boolean;
};

export type ExcelImportDraft = ExcelImportSummary & { records: ExcelImportData };

export type ExcelApplyGroup = "anggota" | "simpanan" | "pinjaman";
export type ExcelBalanceDates = Partial<Record<"simpanan" | "pinjaman", string>>;
export type ExcelApplyOptions = {
  units: { id: string; name: string }[];
  balanceDates: ExcelBalanceDates;
  today: string;
  receipts: ExcelApplyReceipt[];
};
export type ExcelApplySettings = {
  group: ExcelApplyGroup;
  unitId: string;
  cutoffDate?: string;
};
export type ExcelApplyItem = {
  name: string;
  description: string;
  status: "ready" | "existing" | "review";
  amount?: string;
  remainingAmount?: string;
  fix?: { group: ExcelApplyGroup; index: number; basis: string; kind: "member" | "saving" | "loan"; slot?: string };
};
export type ExcelCorrectionIdentity = {
  fullName: string; nik: string; address: string; birthPlace: string; birthDate: string; occupation: string;
  isPengurus: boolean; isPengawas: boolean;
};
export type ExcelCorrectionLoan = {
  contractRef: string; disbursedAt: string; principalAmount: string; totalAmount: string; remainingPrincipal: string;
  remainingAmount: string; termMonths: number; rate: string; installmentAmount: string;
  schedule: { dueDate: string; principal: string; margin: string }[];
};
export type ExcelCorrectionMember = { mode: "link"; memberId: string } | { mode: "identity"; identity: ExcelCorrectionIdentity };
export type ExcelCorrectionInput =
  | { kind: "member"; member: ExcelCorrectionMember }
  | { kind: "saving"; productId?: string; amount: string }
  | { kind: "loan"; productId?: string; contract: ExcelCorrectionLoan };
export type ExcelCorrectionDetail = {
  revision: string;
  identity: ExcelCorrectionIdentity;
  member?: { id: string; memberNumber: string; fullName: string };
  products: { id: string; name: string }[];
  savingEntries?: { slot: string; label: string; amount: string; productId?: string }[];
  productId?: string;
  amount?: string;
  contract?: ExcelCorrectionLoan;
  source: { name: string; memberNumber: string; sheet: string; amounts: ExcelImportField[] };
  related: Record<ExcelApplyGroup, { group: ExcelApplyGroup; index: number; basis: string; label: string }[]>;
};
export type ExcelApplyReview = {
  items: ExcelApplyItem[];
  ready: number;
  total: string;
  products: { name: string; count: number; amount: string }[];
  postingIssue?: string;
  token?: string;
};
export type ExcelApplyReceipt = {
  id: string;
  group: ExcelApplyGroup;
  createdAt: string;
  count: number;
  total: string;
  unit: string;
  cutoffDate?: string;
  journalEntryNos: number[];
};
