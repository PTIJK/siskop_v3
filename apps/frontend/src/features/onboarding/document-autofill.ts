type DocumentKind = "ktp" | "cooperative";

type RegistrationDocumentFields = {
  adminName?: string;
  nik?: string;
  cooperativeNik?: string;
  tenantName?: string;
  registrationNo?: string;
  address?: string;
};

function labeledValue(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`^[ \\t]*(?:${label})(?:[ \\t]*[:;=][ \\t]*(?:\\r?\\n[ \\t]*)?|[ \\t]+)([^\\r\\n]+)`, "im"));
  const value = match?.[1]?.trim();
  return value && !/^\p{L}[\p{L}\s.]{0,35}:/u.test(value) ? value : undefined;
}

export function readCooperativeCertificate(text: string, alternate = "") {
  const fields = readRegistrationFields("cooperative", text, alternate);
  if (!fields.address) return fields;
  const locality = [
    labeledValue(text, "Kecamatan"),
    labeledValue(text, "Kabupaten[ \\t]*/[ \\t]*Kota"),
    labeledValue(text, "Provinsi")
  ].filter(Boolean);
  return { ...fields, address: [fields.address, ...locality].join(", ").slice(0, 500) };
}

export function readRegistrationFields(kind: DocumentKind, text: string, alternate = ""): RegistrationDocumentFields {
  const value = (label: string) => labeledValue(text, label) ?? labeledValue(alternate, label);
  if (kind === "ktp") {
    const nik = [text, alternate]
      .map((page) => labeledValue(page, "NIK(?:[ \\t]*[-–—])?")?.replace(/\s/g, ""))
      .find((candidate) => candidate && /^\d{16}$/.test(candidate));
    return {
      adminName: value("Nama(?:[ \\t]+lengkap)?")?.slice(0, 100),
      nik
    };
  }
  const decreeHeading = (page: string) => page.match(/^[ \t]*(?:NOMOR|NO\.?)[ \t]*:?[ \t]*(?:\r?\n[ \t]*)?(AHU[ \t]*-[ \t]*\d+(?:[ \t]*\.[ \t]*[A-Z0-9]+)*(?:[ \t.]+TAHUN[ \t]+\d{4})?)[ \t]*$/im)?.[1]?.replace(/[ \t]*([.-])[ \t]*/g, "$1");
  const decreeName = (page: string) => page.match(/^[ \t]*(?:TENTANG[ \t]+)?PENGESAHAN\s+PENDIRIAN\s+BADAN\s+HUKUM\s+(KOPERASI[ \t]+[^\r\n]+)$/im)?.[1]?.trim();
  const cooperativeNik = [text, alternate]
    .map((page) => page.match(/^[ \t]*(?:(?:Nomor[ \t]+Induk[ \t]+Koperasi(?:[ \t]+\(NIK\))?|NIK)[ \t:–—=-]*(?:\r?\n[ \t]*)?)((?:\d[ \t]*){13})\r?$/im)?.[1]?.replace(/[ \t]/g, ""))
    .find(Boolean);
  return {
    ...(cooperativeNik ? { cooperativeNik } : {}),
    tenantName: (value("Nama[ \\t]+(?:lengkap[ \\t]+)?koperasi") ?? decreeName(text) ?? decreeName(alternate))?.slice(0, 150),
    registrationNo: (value("(?:Nomor|No\\.?)\\s+(?:badan[ \\t]+hukum|(?:SK[ \\t]+)?pengesahan)") ?? decreeHeading(text) ?? decreeHeading(alternate))?.slice(0, 100),
    address: value("Alamat(?:[ \\t]+koperasi)?")?.slice(0, 500)
  };
}
