// Client-side mirror of the backend's loan math (apps/backend/src/lib/loan-calc.ts),
// used only for an instant on-screen simulation before a loan is submitted —
// the backend recalculates authoritatively on create.
export interface LoanCalculation {
  monthlyPayment: number;
  totalAmount: number;
  totalInterest: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function hitungAngsuranKonvensional(
  principal: number,
  annualRate: number,
  termMonths: number
): LoanCalculation {
  if (annualRate === 0) {
    return { monthlyPayment: round2(principal / termMonths), totalAmount: principal, totalInterest: 0 };
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

export function hitungAngsuranSyariah(
  principal: number,
  annualRate: number,
  termMonths: number
): LoanCalculation {
  const totalInterest = principal * (annualRate / 100) * (termMonths / 12);
  const totalAmount = principal + totalInterest;
  const monthlyPayment = totalAmount / termMonths;
  return {
    monthlyPayment: round2(monthlyPayment),
    totalAmount: round2(totalAmount),
    totalInterest: round2(totalInterest)
  };
}

// Bunga harian (flat, /360 day-count) — mirrors the HARIAN branch of
// calculateLoan on the backend. `termDays` should be the actual calendar
// days between disbursement and maturity; falls back to a 30-day month
// when that isn't known yet, same as the backend default.
export function hitungAngsuranHarian(
  principal: number,
  annualRate: number,
  termMonths: number,
  termDays?: number
): LoanCalculation {
  const days = termDays ?? termMonths * 30;
  const dailyRate = annualRate / 360 / 100;
  const totalInterest = principal * dailyRate * days;
  const totalAmount = principal + totalInterest;
  const monthlyPayment = totalAmount / termMonths;
  return {
    monthlyPayment: round2(monthlyPayment),
    totalAmount: round2(totalAmount),
    totalInterest: round2(totalInterest)
  };
}
