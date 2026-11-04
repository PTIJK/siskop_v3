import { randomInt } from "node:crypto";

const PREFIX = "NEX-";
const LENGTH = 6;

/** Crockford base32 minus 0 and 1, so no code can be misread as O, I or L. */
export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

// Generated codes are 6 characters; an admin's vanity suffix may be 3–12.
const CODE_PATTERN = /^NEX-[A-Z0-9]{3,12}$/;

/** `random(n)` returns an integer in [0, n); defaults to a CSPRNG so codes can't be guessed. */
export function generateReferralCode(random: (max: number) => number = randomInt): string {
  let suffix = "";
  for (let i = 0; i < LENGTH; i++) suffix += REFERRAL_CODE_ALPHABET[random(REFERRAL_CODE_ALPHABET.length)];
  return PREFIX + suffix;
}

/** Codes are case-insensitive and partners often share only the suffix. */
export function normalizeReferralCode(input: string): string {
  const compact = input.replace(/\s+/g, "").toUpperCase();
  return compact.startsWith(PREFIX) ? compact : PREFIX + compact;
}

export function isValidReferralCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export async function createUniqueReferralCode(
  exists: (code: string) => Promise<boolean>,
  { generate = () => generateReferralCode(), maxAttempts = 10 }: { generate?: () => string; maxAttempts?: number } = {}
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generate();
    if (!(await exists(code))) return code;
  }
  throw new Error(`Could not generate a unique referral code after ${maxAttempts} attempts`);
}
