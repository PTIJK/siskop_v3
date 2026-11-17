export function provisionalPage<T>(pending: T[], registeredTotal: number, registeredPageCount: number, page: number, limit: number): T[] {
  const start = Math.max(0, (page - 1) * limit - registeredTotal);
  return pending.slice(start, start + Math.max(0, limit - registeredPageCount));
}
