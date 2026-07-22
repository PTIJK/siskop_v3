import { Prisma, PrismaClient } from '@prisma/client';
import prisma from './prisma';

type NotificationClient = PrismaClient | Prisma.TransactionClient;

export interface CreateNotificationInput {
  type: 'TENANT_REGISTERED' | 'BILLING_BLOCKED' | 'PACKAGE_CHANGED' | 'AUDIT_THRESHOLD_EXCEEDED';
  title: string;
  message: string;
  relatedTenantId?: string;
}

/**
 * Creates a platform-admin notification. Pass a transaction client (`tx`) when
 * called from inside a `prisma.$transaction` block (e.g. tenant registration)
 * so the notification is only persisted if the surrounding transaction commits.
 */
export async function createNotification(
  data: CreateNotificationInput,
  client: NotificationClient = prisma
) {
  return client.notification.create({ data });
}
