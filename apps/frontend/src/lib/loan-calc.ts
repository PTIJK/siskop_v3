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
