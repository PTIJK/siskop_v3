import { useEffect } from "react";
import { PAGE_DESCRIPTION, PAGE_TITLE } from "@/seo/content";

const titles: Record<string, string> = {
  "/": PAGE_TITLE,
  "/mitra": "Program mitra — SISKOP",
  "/mitra/daftar": "Daftar jadi mitra — SISKOP",
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
      description: PAGE_DESCRIPTION,
      "theme-color": "#0d0f15",
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
