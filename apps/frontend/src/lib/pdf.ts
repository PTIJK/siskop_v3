import { getAccessToken } from "@/stores/auth";

/** Streams a PDF the same way apiUpload streams a multipart body — a plain
 * fetch with the bearer token, since the JSON-envelope api client can't hand
 * back a Blob. */
export async function downloadPdf(path: string, filename: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("Gagal mengunduh PDF");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
