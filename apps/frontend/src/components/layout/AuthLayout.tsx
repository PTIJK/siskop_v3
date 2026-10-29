import { Link, useLocation } from "react-router-dom";
import { useOnboardingMetadata } from "@/features/onboarding/metadata";
import { BrandMark } from "./BrandMark";

/**
 * Sign-in shell (design.md §10 Login): the form on the left, a calm panel with
 * two interlocking circles on the right (hidden on phones).
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  useOnboardingMetadata(location.pathname);
  return (
    <div className="grid min-h-screen bg-background min-[901px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary-foreground"
      >
        Lewati ke konten
      </a>
      <div className="flex flex-col px-5 py-6 min-[901px]:px-12">
        <Link to="/" aria-label="SISKOP beranda" className="inline-flex w-fit items-center gap-2.5 rounded-md">
          <BrandMark />
          <span className="text-[17px] font-extrabold tracking-tight">SISKOP</span>
        </Link>
        <main id="konten" tabIndex={-1} className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10 outline-none">
          {children}
        </main>
      </div>
      <aside aria-hidden="true" className="relative hidden items-center justify-center overflow-hidden border-l bg-accent min-[901px]:flex">
        <svg viewBox="0 0 400 400" className="h-[min(70%,420px)] w-auto text-accent-foreground/20" fill="none" stroke="currentColor" strokeWidth="14">
          <circle cx="150" cy="200" r="120" />
          <circle cx="250" cy="200" r="120" />
        </svg>
        <p className="absolute bottom-10 left-10 right-10 max-w-sm text-lg font-extrabold leading-snug tracking-tight text-accent-foreground">
          Satu ruang untuk anggota, simpanan, dan pinjaman koperasi Anda.
        </p>
      </aside>
    </div>
  );
}
