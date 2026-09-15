import { db } from "../../lib/db.js";
import { unauthorized } from "../../lib/errors.js";

export async function firebaseUidFor(user: { identityId?: string | null; firebaseUid: string | null }) {
  if (!user.identityId) return user.firebaseUid;
  const identity = await db.accountIdentity.findUnique({ where: { id: user.identityId } });
  if (!identity?.isActive) throw unauthorized("Akun tidak aktif.");
  return identity.firebaseUid;
}
