import bcrypt from "bcryptjs";
import type { User } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound } from "../../lib/errors.js";
import { toPublicUser } from "../../lib/user-mapper.js";
import type { CreateUserInput, UpdateUserInput } from "./schema.js";

const BCRYPT_ROUNDS = 10;

export async function listUsers(tenantId: string): Promise<User[]> {
  const users = await db.user.findMany({
    where: { tenantId },
    include: { role: true },
    orderBy: { createdAt: "asc" }
  });
  return users.map(toPublicUser);
}

export async function createUser(tenantId: string, data: CreateUserInput): Promise<User> {
  const role = await db.role.findFirst({ where: { id: data.roleId, tenantId } });
  if (!role) throw notFound("Role tidak ditemukan");

  const duplicate = await db.user.findUnique({ where: { tenantId_email: { tenantId, email: data.email } } });
  if (duplicate) throw conflict(`Email ${data.email} sudah digunakan`);

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const created = await db.user.create({
    data: { tenantId, roleId: data.roleId, name: data.name, email: data.email, passwordHash },
    include: { role: true }
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

  const updated = await db.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.roleId !== undefined ? { roleId: data.roleId } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
    },
    include: { role: true }
  });
  return toPublicUser(updated);
}
