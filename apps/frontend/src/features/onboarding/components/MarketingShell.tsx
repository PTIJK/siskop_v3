import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnboardingMetadata } from "../metadata";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "../styles.css";

export function Brand() {
  return (
    <Link to='/' className='brand' aria-label='SISKOP beranda'>
      <span className='brand-symbol' aria-hidden='true'>
        <i />
        <i />
      </span>
      <span>
        siskop<span className='brand-dot'>.</span>
      </span>
    </Link>
  );
}
export function MarketingShell({ children, landing = false }: { children: ReactNode; landing?: boolean }) {
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useOnboardingMetadata(location.pathname);
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  return (
    <div className='marketing'>
      <a href='#main-content' className='skip-link'>
        Lewati ke konten
      </a>
      <header className='marketing-header content-width'>
        <Brand />
        {landing ? (
          <>
            <nav className='desktop-nav' aria-label='Navigasi utama'>
              <a href='#platform'>Platform</a>
              <a href='#paket'>Paket</a>
              <a href='#cara-bergabung'>Cara bergabung</a>
            </nav>
            <div className='header-actions'>
              <Link to='/login'>Masuk</Link>
              <Button asChild size='lg'>
                <a href='#paket'>
                  Mulai sekarang <ArrowUpRight />
                </a>
              </Button>
            </div>
            <Button
              className='mobile-menu-toggle'
              variant='ghost'
              size='icon'
              aria-label={menu ? "Tutup menu" : "Buka menu"}
              aria-expanded={menu}
              aria-controls='mobile-menu'
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </Button>
            {menu ? (
              <nav
                id='mobile-menu'
                className='mobile-nav'
                aria-label='Navigasi seluler'
                onClick={() => setMenu(false)}
              >
                <a href='#platform'>Platform</a>
                <a href='#paket'>Paket</a>
                <a href='#cara-bergabung'>Cara bergabung</a>
                <Link to='/login'>Masuk</Link>
              </nav>
            ) : null}
          </>
        ) : (
          <Link className='back-link' to='/#paket'>
            <ArrowLeft size={16} /> Kembali ke paket
          </Link>
        )}
      </header>
      {children}
      <footer className='marketing-footer content-width'>
        <Brand />
        <p>Tumbuh bersama, dikelola lebih baik.</p>
        <Link to='/checkout/resume'>Lanjutkan pendaftaran</Link>
      </footer>
    </div>
  );
}
export function Steps({ active }: { active: 2 | 3 }) {
  return (
    <ol className='signup-steps' aria-label='Tahapan pendaftaran'>
      {["Paket", "Pendaftaran", "Pembayaran"].map((label, index) => (
        <li key={label} aria-current={active === index + 1 ? "step" : undefined}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
