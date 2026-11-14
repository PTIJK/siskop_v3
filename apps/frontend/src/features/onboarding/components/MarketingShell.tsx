import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { PUBLISHER } from "@/seo/content";
import { useOnboardingMetadata } from "../metadata";
import { useWorkspace } from "../../workspace-domain/WorkspaceBoundary";
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
  const workspace = useWorkspace();
  const central = import.meta.env.VITE_PUBLIC_APP_URL ?? "https://siskop-d0f8c.web.app";
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
              <a href='#fitur'>Fitur</a>
              <a href='#paket' onClick={() => track("cta_pricing_click", { location: "navbar", label: "paket" })}>Paket</a>
              <a href='#cara-bergabung'>Cara bergabung</a>
              <Link to='/mitra'>Jadi mitra</Link>
            </nav>
            <div className='header-actions'>
              <Link to='/login'>Masuk</Link>
              <Button asChild size='lg'>
                <a href='#paket' onClick={() => track("cta_pricing_click", { location: "navbar", label: "mulai_sekarang" })}>
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
                <a href='#fitur'>Fitur</a>
                <a href='#paket' onClick={() => track("cta_pricing_click", { location: "navbar", label: "paket" })}>Paket</a>
                <a href='#cara-bergabung'>Cara bergabung</a>
                <Link to='/mitra'>Jadi mitra</Link>
                <Link to='/login'>Masuk</Link>
              </nav>
            ) : null}
          </>
        ) : (
          workspace ? <a className='back-link' href={`${central}/#paket`}><ArrowLeft size={16} /> Kembali ke paket</a> : <Link className='back-link' to='/#paket'>
            <ArrowLeft size={16} /> Kembali ke paket
          </Link>
        )}
      </header>
      {children}
      <footer className='marketing-footer content-width'>
        <Brand />
        <p>Tumbuh bersama, dikelola lebih baik.</p>
        {/* TODO(owner): publisher name and contact are empty in src/seo/content.ts; nothing renders until set. */}
        {PUBLISHER.name || PUBLISHER.email || PUBLISHER.phone ? (
          <address className='footer-contact'>
            {PUBLISHER.name ? <span>{PUBLISHER.name}</span> : null}
            {PUBLISHER.email ? <a href={`mailto:${PUBLISHER.email}`}>{PUBLISHER.email}</a> : null}
            {PUBLISHER.phone ? <a href={`tel:${PUBLISHER.phone.replace(/[^\d+]/g, "")}`}>{PUBLISHER.phone}</a> : null}
          </address>
        ) : null}
        {workspace ? <a href={`${central}/mitra`}>Jadi mitra</a> : <Link to='/mitra'>Jadi mitra</Link>}
        {workspace ? <a href={`${central}/checkout/resume`}>Lanjutkan pendaftaran</a> : <Link to='/checkout/resume' onClick={() => track("cta_signup_click", { location: "footer", label: "lanjutkan_pendaftaran" })}>Lanjutkan pendaftaran</Link>}
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
