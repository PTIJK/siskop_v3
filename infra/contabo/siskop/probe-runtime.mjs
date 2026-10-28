// Execute via stdin inside the SISKOP API container, whose workdir is /app.
import { randomUUID } from 'node:crypto';
import { db } from './apps/backend/dist/lib/db.js';
import { firebaseAuth } from './apps/backend/dist/modules/onboarding/firebase.js';
import { uploadBucket } from './apps/backend/dist/lib/upload-storage.js';

let stage = 'database';
try {
  const [identity] = await db.$queryRawUnsafe('SELECT current_user AS role, current_database() AS database');
  if (identity.role !== 'siskop_runtime' || identity.database !== 'siskop_staging') throw new Error('Wrong database role');
  const tenants = await db.tenant.count();
  stage = 'transaction';
  const id = 'tenant_staging_release_smoke';
  const before = await db.tenant.findUniqueOrThrow({ where: { id }, select: { isActive: true } });
  try {
    await db.$transaction(async tx => {
      await tx.tenant.update({ where: { id }, data: { isActive: !before.isActive } });
      throw new Error('expected-rollback');
    });
  } catch (error) { if (error.message !== 'expected-rollback') throw error; }
  const after = await db.tenant.findUniqueOrThrow({ where: { id }, select: { isActive: true } });
  if (before.isActive !== after.isActive) throw new Error('Rollback verification failed');
  stage = 'firebase';
  try { await firebaseAuth().getUser('siskop-runtime-permission-probe-not-an-account'); }
  catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  stage = 'storage';
  const file = uploadBucket().file('migration-probes/' + randomUUID() + '.txt');
  const contents = Buffer.from('SISKOP storage connectivity check');
  await file.save(contents, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: 'text/plain', cacheControl: 'private,no-store' } });
  const [metadata] = await file.getMetadata();
  try { const [read] = await file.download(); if (!read.equals(contents)) throw new Error('Upload integrity failed'); }
  finally { await file.delete({ ifGenerationMatch: metadata.generation }); }
  console.log(JSON.stringify({ database_role: identity.role, tenants, transaction_rollback: true,
    firebase_access: true, gcs_write_read_delete: true, existing_business_rows_unchanged: true }));
} catch (error) {
  console.error(JSON.stringify({ failed_stage: stage, error_code: error.code ?? error.name }));
  process.exitCode = 1;
} finally { await db.$disconnect(); }
