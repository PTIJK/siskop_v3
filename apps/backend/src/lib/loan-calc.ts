import { LoanType, RateType } from '@siskop/shared';

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
  rateType: RateType
): LoanCalculation {
  if (loanType === LoanType.SYARIAH || rateType === RateType.MARGIN) {
    // Syariah: flat margin (murabahah)
    const totalInterest = principal * (annualRate / 100) * (termMonths / 12);
    const totalAmount = principal + totalInterest;
    const monthlyPayment = totalAmount / termMonths;
    return {
      monthlyPayment: round2(monthlyPayment),
      totalAmount: round2(totalAmount),
      totalInterest: round2(totalInterest),
    };
  } else {
    // Konvensional: anuitas
    if (annualRate === 0) {
      return {
        monthlyPayment: round2(principal / termMonths),
        totalAmount: principal,
        totalInterest: 0,
      };
    }
    const monthlyRate = annualRate / 12 / 100;
    const monthlyPayment =
      (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
    const totalAmount = monthlyPayment * termMonths;
    return {
      monthlyPayment: round2(monthlyPayment),
      totalAmount: round2(totalAmount),
      totalInterest: round2(totalAmount - principal),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
