import path from 'path';

export default async function globalSetup() {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ||
    'postgresql://siskop:siskop_password@localhost:5432/siskop_dev';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.PLATFORM_DOMAIN = 'localhost';
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_PATH = path.join(__dirname, '..', 'uploads-test');

  // DB is already seeded via `npx prisma db seed` in the root; tests use the
  // existing dev database (siskop_dev) seeded with demo data.
}
