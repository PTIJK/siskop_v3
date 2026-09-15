import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { IdentityProvisioner } from "../src/modules/identity-provisioning/service.js";
import { provisionTenant } from "../src/modules/tenants/provision.js";
import { createUser } from "../src/modules/users/service.js";
import { createPlatformAdmin, createTenant } from "../src/modules/platform/service.js";

const { createFirebaseUser, deleteFirebaseUser } = vi.hoisted(() => ({ createFirebaseUser: vi.fn(), deleteFirebaseUser: vi.fn() }));
vi.mock("../src/modules/onboarding/firebase.js", () => ({ firebaseAuth: () => ({ createUser: createFirebaseUser, deleteUser: deleteFirebaseUser }) }));
const input = { email: "NewAdmin@example.test", name: "New Admin", password: "Fixture-only-123" };
beforeEach(async () => {
  await db.tenant.deleteMany({}); await db.identityProvisioning.deleteMany({});
  createFirebaseUser.mockReset().mockResolvedValue({}); deleteFirebaseUser.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("FIREBASE_ACCOUNT_PROVISIONING_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());
const fixture = () => provisionTenant({ name: "Identity tests", slug: "identity-tests", registrationNo: "IDENTITY", address: "Jakarta", type: "KONVENSIONAL", firstUnit: { type: "KSP", name: "Simpan pinjam" } });
describe("managed Firebase account provisioning", () => {
  it("creates staff, platform admins and a new tenant owner with Firebase bindings and no local password", async () => {
    const { tenant, roles } = await fixture();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const staff = await createUser(tenant.id, { ...input, roleId: roles[0]!.id, unitIds: [unit.id] });
    const admin = await createPlatformAdmin({ tenantId: tenant.id, roleId: roles[0]!.id }, { ...input, email: "platform@example.test" });
    const koperasi = await createTenant({ tenantName: "New koperasi", slug: "new-koperasi", registrationNo: "NEW", address: "Jakarta", type: "KONVENSIONAL", firstUnit: { type: "KSP", name: "KSP" }, adminName: input.name, adminEmail: "owner@example.test", adminPassword: input.password });
    const owner = await db.user.findFirstOrThrow({ where: { tenantId: koperasi.id } });
    for (const id of [staff.id, admin.id, owner.id]) {
      const user = await db.user.findUniqueOrThrow({ where: { id } });
      expect(user.firebaseUid).toBe(`siskop-${id}`); expect(user.authProvider).toBe("password"); expect(user.passwordHash).toBeNull();
      expect((await db.identityProvisioning.findUniqueOrThrow({ where: { uid: user.firebaseUid! } })).status).toBe("LINKED");
    }
    expect(createFirebaseUser).toHaveBeenCalledTimes(3);
    expect(createFirebaseUser.mock.calls[0]![0]).toMatchObject({ email: "newadmin@example.test", password: input.password });
    expect(staff).not.toHaveProperty("passwordHash");
  });
  it("never adopts another person's existing Firebase account by matching email", async () => {
    const create = vi.fn().mockRejectedValue({ code: "auth/email-already-exists" }); const persist = vi.fn();
    await expect(new IdentityProvisioner({ create, remove: vi.fn() }).create(input, persist)).rejects.toThrow("CONFLICT");
    expect(persist).not.toHaveBeenCalled();
    const operation = await db.identityProvisioning.findFirstOrThrow();
    expect(operation.status).toBe("CLEANUP_REQUIRED"); expect(JSON.stringify(operation)).not.toContain(input.password);
  });
  it("recovers an account orphaned by a database failure after the grace period", async () => {
    const create = vi.fn().mockResolvedValue(undefined); const remove = vi.fn().mockResolvedValue(undefined);
    const service = new IdentityProvisioner({ create, remove });
    await expect(service.create(input, async () => { throw new Error("DB unavailable"); })).rejects.toThrow("DB unavailable");
    expect(await service.reconcile()).toEqual({ linked: 0, removed: 0 });
    expect(await service.reconcile(new Date(Date.now() + 16 * 60_000))).toEqual({ linked: 0, removed: 1 });
    expect(remove).toHaveBeenCalledWith(create.mock.calls[0]![0].uid);
    expect(await service.reconcile(new Date(Date.now() + 16 * 60_000))).toEqual({ linked: 0, removed: 0 });
  });
  it("preserves a linked account after interruption before the ledger update", async () => {
    const { tenant, roles } = await fixture();
    const remove = vi.fn(); const service = new IdentityProvisioner({ create: vi.fn().mockResolvedValue(undefined), remove });
    const user = await service.create(input, (fields, tx) => tx.user.create({ data: { ...fields, name: input.name, tenantId: tenant.id, roleId: roles[0]!.id } }));
    await db.identityProvisioning.update({ where: { uid: user.firebaseUid! }, data: { status: "PENDING" } });
    expect(await service.reconcile(new Date(Date.now() + 16 * 60_000))).toEqual({ linked: 1, removed: 0 });
    expect(remove).not.toHaveBeenCalled();
  });
  it("recovers a cleanup interrupted after claiming an abandoned account", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    await db.identityProvisioning.create({ data: { uid: "siskop-interrupted", status: "REMOVING" } });
    const service = new IdentityProvisioner({ create: vi.fn(), remove });
    expect(await service.reconcile()).toEqual({ linked: 0, removed: 0 });
    expect(await service.reconcile(new Date(Date.now() + 16 * 60_000))).toEqual({ linked: 0, removed: 1 });
    expect(remove).toHaveBeenCalledWith("siskop-interrupted");
  });
  it("prevents a delayed creator from committing after recovery claims its account", async () => {
    const persist = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    let service: IdentityProvisioner;
    const create = vi.fn(async () => {
      expect(await service.reconcile(new Date(Date.now() + 16 * 60_000))).toEqual({ linked: 0, removed: 1 });
    });
    service = new IdentityProvisioner({ create, remove });
    await expect(service.create(input, persist)).rejects.toThrow("CONFLICT");
    expect(persist).not.toHaveBeenCalled();
    expect((await db.identityProvisioning.findFirstOrThrow()).status).toBe("CLEANUP_REQUIRED");
  });
  it("rolls back application records if persistence fails and retries failed provider cleanup", async () => {
    const { tenant, roles } = await fixture();
    const remove = vi.fn().mockRejectedValueOnce(new Error("Provider unavailable")).mockResolvedValue(undefined);
    const service = new IdentityProvisioner({ create: vi.fn().mockResolvedValue(undefined), remove });
    await expect(service.create(input, async (fields, tx) => {
      await tx.user.create({ data: { ...fields, name: input.name, tenantId: tenant.id, roleId: roles[0]!.id } });
      throw new Error("Persistence interrupted");
    })).rejects.toThrow("Persistence interrupted");
    expect(await db.user.count({ where: { tenantId: tenant.id, email: input.email.toLowerCase() } })).toBe(0);
    await expect(service.reconcile(new Date(Date.now() + 16 * 60_000))).rejects.toThrow("Provider unavailable");
    expect((await db.identityProvisioning.findFirstOrThrow()).status).toBe("CLEANUP_REQUIRED");
    expect(await service.reconcile(new Date(Date.now() + 16 * 60_000))).toEqual({ linked: 0, removed: 1 });
  });
});
