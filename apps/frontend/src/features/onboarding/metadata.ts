import { useEffect } from "react";

const titles: Record<string, string> = {
  "/": "SISKOP — Koperasi maju. Tumbuh bersama.",
  "/register": "Daftarkan koperasi — SISKOP",
  "/checkout": "Pembayaran koperasi — SISKOP",
  "/checkout/resume": "Lanjutkan pendaftaran — SISKOP",
  "/login": "Masuk — SISKOP",
  "/login/legacy": "Buka workspace — SISKOP"
};

/** Restore document metadata when leaving the public feature for the dashboard. */
export function useOnboardingMetadata(pathname: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = titles[pathname] ?? "SISKOP";
    const restore = Object.entries({
      description:
        "Satu ruang untuk anggota, simpanan, dan masa depan koperasi Anda. Pilih paket SISKOP dan mulai kelola koperasi Anda.",
      "theme-color": "#071b16",
      referrer: "strict-origin-when-cross-origin"
    }).map(([name, content]) => {
      const existing = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      const element = existing ?? document.createElement("meta");
      const previous = element.getAttribute("content");
      element.name = name;
      element.content = content;
      if (!existing) document.head.append(element);
      return () => {
        if (!existing) element.remove();
        else if (previous === null) element.removeAttribute("content");
        else element.content = previous;
      };
    });
    return () => {
      document.title = previousTitle;
      restore.forEach((reset) => reset());
    };
  }, [pathname]);
}
