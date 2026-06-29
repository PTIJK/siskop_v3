import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { formatRupiah, formatTanggalIndonesia, formatTanggalPendek, formatRupiahSingkat } from '@siskop/shared';
