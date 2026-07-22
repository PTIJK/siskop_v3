export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  UNAUTHORIZED: () => new AppError('UNAUTHORIZED', 'Tidak terautentikasi', 401),
  FORBIDDEN: () => new AppError('FORBIDDEN', 'Akses ditolak', 403),
  TENANT_NOT_FOUND: () => new AppError('TENANT_NOT_FOUND', 'Koperasi tidak ditemukan', 404),
  MEMBER_NOT_FOUND: () => new AppError('MEMBER_NOT_FOUND', 'Anggota tidak ditemukan', 404),
  LOAN_NOT_FOUND: () => new AppError('LOAN_NOT_FOUND', 'Pinjaman tidak ditemukan', 404),
  MEMBER_HAS_NO_POKOK_SAVING: () =>
    new AppError('MEMBER_HAS_NO_POKOK_SAVING', 'Anggota belum memiliki simpanan pokok aktif', 400),
  MEMBER_HAS_EXISTING_LOAN: (loanId: string) =>
    new AppError('MEMBER_HAS_EXISTING_LOAN', 'Anggota sudah memiliki pinjaman aktif', 400, {
      loanId,
    }),
  INSUFFICIENT_BALANCE: () => new AppError('INSUFFICIENT_BALANCE', 'Saldo tidak mencukupi', 400),
  VALIDATION_ERROR: (details: unknown) =>
    new AppError('VALIDATION_ERROR', 'Data tidak valid', 422, details),
  PACKAGE_LIMIT_EXCEEDED: (message = 'Paket langganan tidak mengizinkan penambahan data ini') =>
    new AppError('PACKAGE_LIMIT_EXCEEDED', message, 422),
  FEATURE_NOT_ENTITLED: (message = 'Fitur ini tidak termasuk dalam paket langganan Anda') =>
    new AppError('FEATURE_NOT_ENTITLED', message, 403),
  ROLE_IN_USE: (message: string) => new AppError('ROLE_IN_USE', message, 409),
  ACCOUNT_CODE_INVALID_FORMAT: (message: string) =>
    new AppError('ACCOUNT_CODE_INVALID_FORMAT', message, 422),
  ACCOUNT_CODE_DUPLICATE: (message = 'Kode akun sudah digunakan') =>
    new AppError('ACCOUNT_CODE_DUPLICATE', message, 409),
  ACCOUNT_IN_USE: (message = 'Akun tidak dapat dihapus atau dinonaktifkan karena masih digunakan') =>
    new AppError('ACCOUNT_IN_USE', message, 409),
  ACCOUNT_NOT_FOUND: () => new AppError('ACCOUNT_NOT_FOUND', 'Akun tidak ditemukan', 404),
  MAPPING_ACCOUNT_CATEGORY_MISMATCH: (message: string) =>
    new AppError('MAPPING_ACCOUNT_CATEGORY_MISMATCH', message, 422),
  JOURNAL_ENTRY_UNBALANCED: (message = 'Entri jurnal tidak seimbang antara debit dan kredit') =>
    new AppError('JOURNAL_ENTRY_UNBALANCED', message, 500),
  REPORT_PERIOD_INVALID: (message = 'Rentang tanggal laporan tidak valid') =>
    new AppError('REPORT_PERIOD_INVALID', message, 422),
  SHU_DISTRIBUTION_PERCENT_INVALID: (message = 'Jumlah persentase distribusi SHU harus 100%') =>
    new AppError('SHU_DISTRIBUTION_PERCENT_INVALID', message, 422),
};
