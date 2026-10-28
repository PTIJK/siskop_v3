export type SniffedFileType = "jpg" | "png" | "pdf";

const SIGNATURES: Array<{ type: SniffedFileType; bytes: number[] }> = [
  { type: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { type: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "pdf", bytes: [0x25, 0x50, 0x44, 0x46] } // "%PDF"
];

/**
 * Identifies a file by its leading magic bytes rather than trusting the
 * caller-declared MIME type. Both internal and public KTP uploads validate
 * these signatures before storing the file. Only 3 signatures are needed,
 * so this is hand-rolled
 * rather than pulling in a dependency for it.
 */
export function sniffFileType(buffer: Buffer): SniffedFileType | null {
  for (const { type, bytes } of SIGNATURES) {
    if (buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b)) {
      return type;
    }
  }
  return null;
}
