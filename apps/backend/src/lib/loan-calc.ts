import type { LoanType, RateType } from "@siskop/types";

export interface LoanCalculation {
  monthlyPayment: number;
  totalAmount: number;
  totalInterest: number;
}

export function calculateLoan(
  principal: number,
  annualRate: number,
  termMonths: number,
  loanType: LoanType,
  rateType: RateType,
  options?: { termDays?: number }
): LoanCalculation {
  if (rateType === "HARIAN") {
    // Bunga harian (flat): pokok awal x rate harian x jumlah hari tenor
    // sebenarnya, konvensi 1 tahun = 360 hari. Beda dari MARGIN, yang
    // mengasumsikan bulan penuh (termMonths/12) — HARIAN dihitung dari
    // hari kalender riil antara pencairan dan jatuh tempo, jatuh ke
    // asumsi 30 hari/bulan hanya bila termDays tidak diberikan (mis.
    // saat memvalidasi konfigurasi tanpa tanggal pencairan).
    const termDays = options?.termDays ?? termMonths * 30;
    const dailyRate = annualRate / 360 / 100;
    const totalInterest = principal * dailyRate * termDays;
    const totalAmount = principal + totalInterest;
    const monthlyPayment = totalAmount / termMonths;
    return {
      monthlyPayment: round2(monthlyPayment),
      totalAmount: round2(totalAmount),
      totalInterest: round2(totalInterest)
    };
  }

  if (loanType === "SYARIAH" || rateType === "MARGIN") {
    // Syariah: flat margin (murabahah).
    const totalInterest = principal * (annualRate / 100) * (termMonths / 12);
    const totalAmount = principal + totalInterest;
    const monthlyPayment = totalAmount / termMonths;
    return {
      monthlyPayment: round2(monthlyPayment),
      totalAmount: round2(totalAmount),
      totalInterest: round2(totalInterest)
    };
  }

  // Konvensional: anuitas.
  if (annualRate === 0) {
    return {
      monthlyPayment: round2(principal / termMonths),
      totalAmount: principal,
      totalInterest: 0
    };
  }
  const monthlyRate = annualRate / 12 / 100;
  const monthlyPayment = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
  const totalAmount = monthlyPayment * termMonths;
  return {
    monthlyPayment: round2(monthlyPayment),
    totalAmount: round2(totalAmount),
    totalInterest: round2(totalAmount - principal)
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
