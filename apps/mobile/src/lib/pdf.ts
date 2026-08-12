import { getAccessToken } from "@/stores/auth";

/**
 * Mobile-safe PDF handling (FR-MOB-RPT-02, docs/06-PRD-SISKOP-Mobile-Version.md
 * §7/§8.1). Desktop's `lib/pdf.ts` triggers a download via Blob + a
 * programmatic `<a download>` click — flagged in the UI audit as unreliable
 * on iOS Safari and inside installed-PWA contexts (silent failure or a blank
 * tab instead of a download).
 *
 * This opens the PDF in a new tab instead, using the "open a blank tab
 * synchronously, fill it in after the fetch resolves" pattern: `window.open`
 * must run inside the original click's call stack or Safari's popup blocker
 * treats it as an unrequested popup and blocks it — awaiting the fetch first
 * and calling `window.open` afterward loses that user-gesture context.
 *
 * Real-device verification (iOS Safari specifically) is still pending per
 * docs/06-PRD-SISKOP-Mobile-Version.md §8.4/§12 — this is the best
 * code-level mitigation available without that verification, not a final
 * confirmed-working claim.
 */
export async function openPdf(path: string): Promise<void> {
  const newTab = window.open("", "_blank");

  try {
    const token = getAccessToken();
    const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error("Gagal memuat PDF");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    if (newTab) {
      newTab.location.href = url;
    } else {
      // Popup blocked despite the synchronous open attempt (some browsers
      // still block it) — fall back to same-tab navigation.
      window.location.href = url;
    }
  } catch (err) {
    newTab?.close();
    throw err;
  }
}
