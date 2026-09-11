import bcrypt from "bcryptjs";
import type { User } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { toPublicUser } from "../../lib/user-mapper.js";
import type { CreateUserInput, UpdateUserInput } from "./schema.js";

const BCRYPT_ROUNDS = 10;
const USER_INCLUDE = { role: true, unitAssignments: true } as const;

/** Every id in `unitIds` must be an active CooperativeUnit owned by `tenantId` — never trusted at face value (CLAUDE.md rule 1). */
async function assertUnitsBelongToTenant(tenantId: string, unitIds: string[]): Promise<void> {
  const units = await db.cooperativeUnit.findMany({ where: { tenantId, id: { in: unitIds } } });
  if (units.length !== unitIds.length) throw validationError("Salah satu unit tidak valid");
}

export async function listUsers(tenantId: string): Promise<User[]> {
  const users = await db.user.findMany({
    where: { tenantId },
    include: USER_INCLUDE,
    orderBy: { createdAt: "asc" }
  });
  return users.map(toPublicUser);
}

export async function createUser(tenantId: string, data: CreateUserInput): Promise<User> {
  const role = await db.role.findFirst({ where: { id: data.roleId, tenantId } });
  if (!role) throw notFound("Role tidak ditemukan");

  const duplicate = await db.user.findUnique({ where: { tenantId_email: { tenantId, email: data.email } } });
  if (duplicate) throw conflict(`Email ${data.email} sudah digunakan`);

  await assertUnitsBelongToTenant(tenantId, data.unitIds);

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const created = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { tenantId, roleId: data.roleId, name: data.name, email: data.email, passwordHash }
    });
    await tx.userUnit.createMany({ data: data.unitIds.map((unitId) => ({ userId: user.id, unitId })) });
    return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: USER_INCLUDE });
  });
  return toPublicUser(created);
}

export async function updateUser(
  tenantId: string,
  id: string,
  data: UpdateUserInput,
  callerUserId: string
): Promise<User> {
  const user = await db.user.findFirst({ where: { id, tenantId } });
  if (!user) throw notFound("Pengguna tidak ditemukan");

  // Mirrors the ">=1 active unit" invariant in config/service.ts: an admin who
  // deactivates their own account would lock themselves out with no one else
  // able to undo it from this session.
  if (data.isActive === false && id === callerUserId) {
    throw conflict("Tidak dapat menonaktifkan akun sendiri");
  }

  if (data.roleId) {
    const role = await db.role.findFirst({ where: { id: data.roleId, tenantId } });
    if (!role) throw notFound("Role tidak ditemukan");
  }

  if (data.email && data.email !== user.email) {
    const duplicate = await db.user.findUnique({ where: { tenantId_email: { tenantId, email: data.email } } });
    if (duplicate) throw conflict(`Email ${data.email} sudah digunakan`);
  }

  if (data.unitIds !== undefined) {
    await assertUnitsBelongToTenant(tenantId, data.unitIds);
  }

  const updated = await db.$transaction(async (tx) => {
    if (data.unitIds !== undefined) {
      await tx.userUnit.deleteMany({ where: { userId: id } });
      await tx.userUnit.createMany({ data: data.unitIds.map((unitId) => ({ userId: id, unitId })) });
    }

    return tx.user.update({
      where: { id, tenantId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.roleId !== undefined ? { roleId: data.roleId } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
      },
      include: USER_INCLUDE
    });
  });
  return toPublicUser(updated);
}
