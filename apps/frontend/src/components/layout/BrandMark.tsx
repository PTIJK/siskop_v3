/** SISKOP logo: two interlocking circles, tinted by the tenant's brand colour. */
export function BrandMark({ className = "h-[30px] w-[30px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`${className} shrink-0`} role="img" aria-label="SISKOP" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="16" r="8" className="text-brand" />
      <circle cx="20" cy="16" r="8" className="text-primary" />
    </svg>
  );
}
