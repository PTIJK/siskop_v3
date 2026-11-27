import type { CooperativeRegistryMatch } from "@siskop/types";
import { z } from "zod";

export const cooperativeNikSchema = z.string().trim().regex(/^\d{13}$/);

const ODS_SEARCH = "https://nik.kop.go.id/odsnik/nikd";
const ODS_DETAIL = "https://nik.kop.go.id/odsnik/detail";
const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function plainText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&([a-z0-9#]+);/gi, (entity, key: string) => entities[key] ?? entity).replace(/\s+/g, " ").trim();
}

export function parseOdsResult(html: string): (CooperativeRegistryMatch & { detailId: string }) | null {
  // shortcut: ODS exposes a public HTML form, switch to an official API if Kemenkop publishes one.
  const matches = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).filter(([, row]) =>
    /<input\b[^>]*\bname=["']nik["']/i.test(row ?? "")
  );
  if (matches.length !== 1) return null;
  const row = matches[0]?.[1] ?? "";
  const detailInput = row.match(/<input\b[^>]*\bname=["']nik["'][^>]*>/i)?.[0];
  const detailId = detailInput?.match(/\svalue=["']([A-Za-z0-9_-]{1,80})["']/i)?.[1];
  const name = plainText(row.match(/<button\b[^>]*>([\s\S]*?)<\/button>/i)?.[1] ?? "");
  const registrationNo = plainText(row.match(/<img\b[^>]*icon_nbh\.png[^>]*>([^<]+)/i)?.[1] ?? "");
  if (!detailId || !name || name.length > 150 || !registrationNo || registrationNo.length > 100) return null;
  return { detailId, name, registrationNo };
}

async function postOds(url: string, fields: Record<string, string>, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    body: new URLSearchParams(fields),
    redirect: "error",
    signal
  });
  if (!response.ok) throw new Error("ODS Koperasi unavailable");
  return response.text();
}

export async function lookupCooperative(nik: string): Promise<CooperativeRegistryMatch | null> {
  const signal = AbortSignal.timeout(5000);
  const html = await postOds(ODS_SEARCH, { dcat: nik }, signal);
  const search = html.match(/<input\b[^>]*\bname=["']dcat["'][^>]*>/i)?.[0];
  if (!search || !search.includes(`value="${nik}"`) && !search.includes(`value='${nik}'`))
    throw new Error("Unexpected ODS search response");

  const candidate = parseOdsResult(html);
  if (!candidate) return null;
  const detail = plainText(await postOds(ODS_DETAIL, { nik: candidate.detailId }, signal));
  const listedNiks = new Set(Array.from(
    detail.matchAll(/\b(?:Nomor Induk Koperasi(?:\s*\(\s*NIK\s*\))?|NIK Koperasi|NIK)\s*:?\s*(\d{13})(?!\d)/gi),
    ([, number]) => number
  ));
  if (listedNiks.size !== 1 || !listedNiks.has(nik)) return null;
  return { name: candidate.name, registrationNo: candidate.registrationNo };
}
