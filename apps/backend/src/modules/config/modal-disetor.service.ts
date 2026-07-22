import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { Errors } from '../../lib/errors';

function serialize(tenant: {
  modalDisetor: Prisma.Decimal | null;
  auditThresholdNotifiedAt: Date | null;
}) {
  return {
    modalDisetor: tenant.modalDisetor?.toString() ?? null,
    auditThresholdNotifiedAt: tenant.auditThresholdNotifiedAt,
  };
}

export class ModalDisetorService {
  async get(tenantId: string) {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { modalDisetor: true, auditThresholdNotifiedAt: true },
    });
    return serialize(tenant);
  }

  async update(tenantId: string, modalDisetor: number | null) {
    if (modalDisetor !== null && modalDisetor < 0) {
      throw Errors.MODAL_DISETOR_INVALID();
    }

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { modalDisetor },
      select: { modalDisetor: true, auditThresholdNotifiedAt: true },
    });
    return serialize(tenant);
  }
}

export const modalDisetorService = new ModalDisetorService();
