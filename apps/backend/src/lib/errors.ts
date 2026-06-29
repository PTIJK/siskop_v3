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
};
