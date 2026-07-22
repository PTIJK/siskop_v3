import request from 'supertest';
import app from '../src/app';
import {
  testPrisma,
  createTestTenant,
  createTestRoles,
  createTestUser,
  loginAs,
  cleanupTenant,
  parseCookieHeaders,
} from './helpers/setup';

const api = request(app);

let tenant: any;
let adminCookies: string;
let tellerCookies: string;
let superAdminRole: any;
let tellerRole: any;
let adminUserId: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  const roles = await createTestRoles(tenant.id);
  superAdminRole = roles.superAdminRole;
  tellerRole = roles.tellerRole;

  const adminUser = await createTestUser(tenant.id, superAdminRole.id, 'admin@config-test.com');
  adminUserId = adminUser.id;
  await createTestUser(tenant.id, tellerRole.id, 'teller@config-test.com');

  adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@config-test.com'));
  tellerCookies = parseCookieHeaders(await loginAs(app, tenant, 'teller@config-test.com'));
});

afterAll(async () => {
  await cleanupTenant(tenant.id);
  await testPrisma.$disconnect();
});

describe('Config Module', () => {
  // ── Profile ─────────────────────────────────────────────────────────────────

  // Profile = the current user's own profile, not the tenant record
  describe('GET /api/config/profile', () => {
    it('returns current user profile including role', async () => {
      const res = await api
        .get('/api/config/profile')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(adminUserId);
      expect(res.body.data.email).toBe('admin@config-test.com');
      expect(res.body.data.role).toBeDefined();
    });

    it('returns 401 without authentication', async () => {
      const res = await api
        .get('/api/config/profile')
        .set('Host', `${tenant.slug}.localhost`);
      expect(res.status).toBe(401);
    });

    it('teller can also read their own profile', async () => {
      const res = await api
        .get('/api/config/profile')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies);
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('teller@config-test.com');
    });
  });

  // Profile update = user updates their own name/email/password; no RBAC guard
  describe('PUT /api/config/profile', () => {
    it('admin can update their own name', async () => {
      const res = await api
        .put('/api/config/profile')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ name: 'Admin Diperbarui' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Admin Diperbarui');
    });

    it('teller can also update their own profile (no RBAC guard on this endpoint)', async () => {
      const res = await api
        .put('/api/config/profile')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies)
        .send({ name: 'Teller Diperbarui' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Teller Diperbarui');
    });

    it('returns 401 without authentication', async () => {
      const res = await api
        .put('/api/config/profile')
        .set('Host', `${tenant.slug}.localhost`)
        .send({ name: 'Unauthorized' });
      expect(res.status).toBe(401);
    });
  });

  // ── User management ──────────────────────────────────────────────────────────

  describe('GET /api/config/users', () => {
    it('returns list of users for the tenant', async () => {
      const res = await api
        .get('/api/config/users')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('returns 403 when teller tries to list users', async () => {
      const res = await api
        .get('/api/config/users')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/config/users', () => {
    let createdUserId: string;

    it('creates a new user in the tenant', async () => {
      const res = await api
        .post('/api/config/users')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          name: 'User Baru',
          email: `baru.${Date.now()}@config-test.com`,
          password: 'Test123!',
          roleId: tellerRole.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      createdUserId = res.body.data.id;
    });

    it('rejects duplicate email within same tenant with 409', async () => {
      const res = await api
        .post('/api/config/users')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          name: 'Duplicate',
          email: 'admin@config-test.com',
          password: 'Test123!',
          roleId: tellerRole.id,
        });
      expect(res.status).toBe(409);
    });

    afterAll(async () => {
      if (createdUserId) {
        await testPrisma.user.delete({ where: { id: createdUserId } });
      }
    });
  });

  describe('PUT /api/config/users/:id', () => {
    it('updates user name', async () => {
      const res = await api
        .put(`/api/config/users/${adminUserId}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ name: 'Admin Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Admin Updated');
    });
  });

  describe('DELETE /api/config/users/:id', () => {
    it('deactivates a user (soft delete)', async () => {
      const newUser = await createTestUser(tenant.id, tellerRole.id, `todeactivate.${Date.now()}@config-test.com`);

      const res = await api
        .delete(`/api/config/users/${newUser.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);

      const user = await testPrisma.user.findUnique({ where: { id: newUser.id } });
      expect(user?.isActive).toBe(false);
    });
  });

  // ── Role management ──────────────────────────────────────────────────────────

  describe('GET /api/config/roles', () => {
    it('returns list of roles for the tenant', async () => {
      const res = await api
        .get('/api/config/roles')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('returns 403 when teller tries to list roles', async () => {
      const res = await api
        .get('/api/config/roles')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/config/roles', () => {
    it('creates a new role with custom permissions', async () => {
      const res = await api
        .post('/api/config/roles')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          name: 'Custom Role',
          permissions: {
            dashboard: { read: true },
            members: { create: false, read: true, update: false, delete: false },
            savings: { create: false, read: true, update: false, delete: false },
            loans: { create: false, read: true, update: false, delete: false },
            reports: { read: true, export: false, update: false },
            config: { read: false, update: false },
            users: { create: false, read: false, update: false, delete: false },
            roles: { create: false, read: false, update: false, delete: false },
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Custom Role');

      // Cleanup
      await testPrisma.role.delete({ where: { id: res.body.data.id } });
    });
  });

  describe('PUT /api/config/roles/:id', () => {
    it('updates role name', async () => {
      const res = await api
        .put(`/api/config/roles/${tellerRole.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ name: 'Kasir' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Kasir');
    });
  });

  describe('DELETE /api/config/roles/:id', () => {
    it('deletes a role with no assigned users', async () => {
      const role = await testPrisma.role.create({
        data: {
          tenantId: tenant.id,
          name: 'Role Kosong',
          permissions: { dashboard: { read: true } },
        },
      });

      const res = await api
        .delete(`/api/config/roles/${role.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const found = await testPrisma.role.findUnique({ where: { id: role.id } });
      expect(found).toBeNull();
    });

    it('returns 409 when the role still has users assigned', async () => {
      const res = await api
        .delete(`/api/config/roles/${tellerRole.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROLE_IN_USE');
    });

    it('returns 403 when teller tries to delete a role', async () => {
      const role = await testPrisma.role.create({
        data: {
          tenantId: tenant.id,
          name: 'Role Untuk Ditolak',
          permissions: { dashboard: { read: true } },
        },
      });

      const res = await api
        .delete(`/api/config/roles/${role.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies);

      expect(res.status).toBe(403);

      await testPrisma.role.delete({ where: { id: role.id } });
    });
  });
});
