import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, type TxClient } from "../../lib/db.js";
import { conflict } from "../../lib/errors.js";
import { firebaseAuth } from "../onboarding/firebase.js";

type AccountInput = { email: string; name: string; password: string };
type IdentityFields = { id: string; email: string; passwordHash: string | null; firebaseUid: string | null; authProvider: string | null };
type PersistIdentity<T> = (fields: IdentityFields, tx: TxClient) => Promise<T>;
export interface IdentityProvider {
  create(input: AccountInput & { uid: string }): Promise<void>;
  remove(uid: string): Promise<void>;
}
const firebaseProvider: IdentityProvider = {
  async create({ uid, email, name, password }) { await firebaseAuth().createUser({ uid, email, displayName: name, password }); },
  async remove(uid) {
    try { await firebaseAuth().deleteUser(uid); }
    catch (error) { if ((error as { code?: string }).code !== "auth/user-not-found") throw error; }
  }
};

/** Firebase and PostgreSQL cannot share a transaction. Record ownership of the
 * external account first, then persist the user. A recovery job can safely
 * remove only abandoned UIDs created by this service; passwords are never stored. */
export class IdentityProvisioner {
  constructor(private readonly provider: IdentityProvider) {}
  async create<T>(input: AccountInput, persist: PersistIdentity<T>): Promise<T> {
    const id = randomUUID();
    const uid = `siskop-${id}`;
    const email = input.email.trim().toLowerCase();
    await db.identityProvisioning.create({ data: { uid } });
    try {
      await this.provider.create({ ...input, email, uid });
      return await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT uid FROM "IdentityProvisioning" WHERE uid = ${uid} FOR UPDATE`;
        const operation = await tx.identityProvisioning.findUniqueOrThrow({ where: { uid } });
        if (operation.status !== "PENDING") throw conflict("Pendaftaran akun telah kedaluwarsa. Silakan coba lagi.");
        const result = await persist({ id, email, firebaseUid: uid, authProvider: "password", passwordHash: null }, tx);
        await tx.identityProvisioning.update({ where: { uid }, data: { status: "LINKED" } });
        return result;
      });
    } catch (error) {
      await db.identityProvisioning.updateMany({ where: { uid, status: { not: "LINKED" } }, data: { status: "CLEANUP_REQUIRED" } }).catch(() => {});
      if ((error as { code?: string }).code === "auth/email-already-exists" || (error as { code?: string }).code === "auth/email-already-in-use") {
        throw conflict("Email sudah terdaftar di Firebase. Hubungi pengelola untuk menautkan akun yang sudah ada.");
      }
      if (typeof (error as { code?: unknown }).code === "string" && String((error as { code: string }).code).startsWith("auth/")) {
        throw conflict("Akun Firebase belum dapat dibuat. Silakan coba lagi setelah pengelola memeriksa pendaftaran.");
      }
      throw error;
    }
  }
  async reconcile(now = new Date()): Promise<{ linked: number; removed: number }> {
    // A grace period avoids racing a provider request that timed out after commit.
    const cutoff = new Date(now.getTime() - 15 * 60_000);
    const recoverable = ["PENDING", "CLEANUP_REQUIRED", "REMOVING"];
    const operations = await db.identityProvisioning.findMany({ where: { status: { in: recoverable }, updatedAt: { lt: cutoff } }, take: 100, orderBy: { updatedAt: "asc" } });
    let linked = 0; let removed = 0;
    for (const operation of operations) {
      const disposition = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT uid FROM "IdentityProvisioning" WHERE uid = ${operation.uid} FOR UPDATE`;
        const current = await tx.identityProvisioning.findUniqueOrThrow({ where: { uid: operation.uid } });
        if (!recoverable.includes(current.status) || current.updatedAt >= cutoff) return "skip";
        const user = await tx.accountIdentity.findUnique({ where: { firebaseUid: operation.uid }, include: { _count: { select: { users: true } } } });
        const linked = user && user._count.users > 0;
        await tx.identityProvisioning.update({ where: { uid: operation.uid }, data: { status: linked ? "LINKED" : "REMOVING" } });
        return linked ? "linked" : "remove";
      });
      if (disposition === "linked") linked++;
      if (disposition === "remove") {
        // A late creator sees REMOVING and cannot commit a user for this UID.
        try {
          await this.provider.remove(operation.uid);
          await db.identityProvisioning.updateMany({ where: { uid: operation.uid, status: "REMOVING" }, data: { status: "REMOVED" } }); removed++;
        } catch (error) {
          await db.identityProvisioning.update({ where: { uid: operation.uid }, data: { status: "CLEANUP_REQUIRED" } });
          throw error;
        }
      }
    }
    return { linked, removed };
  }
}
export const identityProvisioner = new IdentityProvisioner(firebaseProvider);
export async function withManagedIdentity<T>(input: AccountInput, persist: PersistIdentity<T>): Promise<T> {
  if (process.env.FIREBASE_ACCOUNT_PROVISIONING_ENABLED === "true") return identityProvisioner.create(input, persist);
  const passwordHash = await bcrypt.hash(input.password, 10);
  return db.$transaction(tx => persist({ id: randomUUID(), email: input.email.trim().toLowerCase(), passwordHash, firebaseUid: null, authProvider: null }, tx));
}
