import bcrypt from "bcryptjs";
import { verify } from "@node-rs/bcrypt";

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Native UTF-8 conversion replaces lone surrogates, which could authenticate a different password.
  if (/[\uD800-\uDFFF]/u.test(password)) return Promise.resolve(false);
  if (!/^\$2[aby]\$/.test(hash)) return bcrypt.compare(password, hash);
  return verify(password, hash);
}
