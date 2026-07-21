import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError, Errors } from '../../lib/errors';
import { generateMemberId, generateAccountNumber } from '../../lib/id-generator';
import { CreateMemberInput, UpdateMemberInput, MemberQuery } from './members.schema';

export class MembersService {
  async list(tenantId: string, query: MemberQuery) {
    const { page, limit, search, sortBy, sortOrder, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MemberWhereInput = {
      tenantId,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { nik: { contains: search } },
              { memberId: { contains: search, mode: 'insensitive' } },
              { accountNumber: { contains: search } },
            ],
          }
        : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.member.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.member.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }

  async findById(tenantId: string, id: string) {
    const member = await prisma.member.findFirst({
      where: { id, tenantId },
      include: {
        savings: {
          include: { savingConfig: true },
          where: { isActive: true },
        },
        loans: {
          where: { status: { in: ['ACTIVE', 'PENDING'] } },
          include: { loanConfig: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!member) throw Errors.MEMBER_NOT_FOUND();
    return member;
  }

  async create(tenantId: string, tenantSlug: string, data: CreateMemberInput) {
    const dupNIK = await prisma.member.findFirst({
      where: { tenantId, nik: data.nik },
    });
    if (dupNIK) {
      throw new AppError('NIK_EXISTS', 'NIK sudah terdaftar di koperasi ini', 409);
    }

    const memberId = await generateMemberId(tenantId, tenantSlug);
    const accountNumber = await generateAccountNumber();

    return prisma.member.create({
      data: {
        tenantId,
        memberId,
        accountNumber,
        fullName: data.fullName,
        nik: data.nik,
        address: data.address,
        birthPlace: data.birthPlace,
        birthDate: new Date(data.birthDate),
        occupation: data.occupation,
        isActive: true,
      },
    });
  }

  async update(tenantId: string, id: string, data: UpdateMemberInput) {
    const member = await prisma.member.findFirst({ where: { id, tenantId } });
    if (!member) throw Errors.MEMBER_NOT_FOUND();

    if (data.nik && data.nik !== member.nik) {
      const dupNIK = await prisma.member.findFirst({
        where: { tenantId, nik: data.nik },
      });
      if (dupNIK) throw new AppError('NIK_EXISTS', 'NIK sudah terdaftar di koperasi ini', 409);
    }

    return prisma.member.update({
      where: { id },
      data: {
        ...(data.fullName && { fullName: data.fullName }),
        ...(data.nik && { nik: data.nik }),
        ...(data.address && { address: data.address }),
        ...(data.birthPlace && { birthPlace: data.birthPlace }),
        ...(data.birthDate && { birthDate: new Date(data.birthDate) }),
        ...(data.occupation && { occupation: data.occupation }),
      },
    });
  }

  async deactivate(tenantId: string, id: string): Promise<void> {
    const member = await prisma.member.findFirst({ where: { id, tenantId } });
    if (!member) throw Errors.MEMBER_NOT_FOUND();

    await prisma.member.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async uploadKTP(tenantId: string, id: string, filePath: string) {
    const member = await prisma.member.findFirst({ where: { id, tenantId } });
    if (!member) throw Errors.MEMBER_NOT_FOUND();

    return prisma.member.update({
      where: { id },
      data: { ktpPhotoUrl: filePath },
    });
  }
}

export const membersService = new MembersService();
