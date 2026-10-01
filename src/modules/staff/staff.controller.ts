import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { isGstStateCode, isValidGstin } from '@neon-adda/shared';
import { z } from 'zod';
import { Meta, type RequestMeta } from '../../common/http/request-meta';
import { temporaryPassword } from '../../common/security/temporary-password';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Authenticated, CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';

const roleKey = z.string().regex(/^[a-z_]{3,40}$/);

const inviteSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email('Enter a work email'),
  roleKey,
});

const updateSchema = z.object({
  roleKey,
  status: z.enum(['ACTIVE', 'BLOCKED']),
});

const resetSchema = z.object({ resetTwoFactor: z.boolean().default(false) });

const companySchema = z
  .object({
    legalName: z.string().trim().min(2).max(160),
    tradeName: z.string().trim().max(120).optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .nullish()
      .transform((value) => value || null)
      .refine((value) => value === null || isValidGstin(value), 'Enter a valid GSTIN'),
    address: z.string().trim().min(10, 'Enter the registered address').max(400),
    stateCode: z.string().refine(isGstStateCode, 'Choose a state'),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().min(8).max(20),
  })
  .refine((company) => !company.gstin || company.gstin.slice(0, 2) === company.stateCode, {
    path: ['gstin'],
    message: 'The GSTIN is registered in a different state',
  });

/** Staff accounts, roles and company-wide settings. */
@Controller('admin')
@Authenticated(['admin'])
export class StaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('staff')
  @RequirePermissions('users.read')
  async list() {
    const staff = await this.prisma.user.findMany({
      where: { type: 'STAFF', deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        lastLoginAt: true,
        lockedUntil: true,
        totpSecret: true,
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    });

    return staff.map(({ totpSecret, roles, lockedUntil, ...member }) => ({
      ...member,
      locked: Boolean(lockedUntil && lockedUntil > new Date()),
      twoFactorEnabled: Boolean(totpSecret),
      roles: roles.map(({ role }) => role),
    }));
  }

  @Get('roles')
  @RequirePermissions('users.read')
  async roles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });
    return roles.map((role) => ({
      key: role.key,
      name: role.name,
      members: role._count.users,
      permissions: role.permissions.map((p) => p.permission.key).sort(),
    }));
  }

  /** Creates the account with a one-time password. Two-factor setup is forced at first sign-in. */
  @Post('staff')
  @RequirePermissions('users.write')
  async invite(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(inviteSchema)) dto: z.infer<typeof inviteSchema>,
    @Meta() meta: RequestMeta,
  ) {
    const role = await this.role(dto.roleKey);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException({ code: 'EMAIL_TAKEN', title: 'An account already uses this email' });
    }

    const password = temporaryPassword();
    const passwordHash = await hash(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          type: 'STAFF',
          name: dto.name,
          email: dto.email,
          passwordHash,
          roles: { create: { roleId: role.id } },
        },
      });
      await this.audit.record(
        {
          actorId: auth.sub,
          action: 'staff.invited',
          entity: 'user',
          entityId: created.id,
          after: dto,
          ...meta,
        },
        tx,
      );
      return created;
    });
    return { id: user.id, email: dto.email, temporaryPassword: password };
  }

  @Put('staff/:id')
  @RequirePermissions('users.write')
  async update(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) dto: z.infer<typeof updateSchema>,
    @Meta() meta: RequestMeta,
  ) {
    if (id === auth.sub) {
      throw new ForbiddenException({
        code: 'SELF_CHANGE',
        title: 'Ask another admin to change your own access',
      });
    }
    await this.member(id);
    const role = await this.role(dto.roleKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.create({ data: { userId: id, roleId: role.id } });
      await tx.user.update({ where: { id }, data: { status: dto.status } });
      // Permissions travel in the access token, so existing sessions end and pick up the change at sign-in.
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        { actorId: auth.sub, action: 'staff.updated', entity: 'user', entityId: id, after: dto, ...meta },
        tx,
      );
    });
    return this.list();
  }

  @Post('staff/:id/reset-password')
  @HttpCode(200)
  @RequirePermissions('users.write')
  async resetPassword(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetSchema)) dto: z.infer<typeof resetSchema>,
    @Meta() meta: RequestMeta,
  ) {
    if (id === auth.sub) {
      throw new ForbiddenException({
        code: 'SELF_CHANGE',
        title: 'Ask another admin to reset your password',
      });
    }
    await this.member(id);
    const password = temporaryPassword();
    const passwordHash = await hash(password);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          ...(dto.resetTwoFactor ? { totpSecret: null } : {}),
        },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: auth.sub,
          action: 'staff.password-reset',
          entity: 'user',
          entityId: id,
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    return { temporaryPassword: password };
  }

  @Get('settings/company')
  @RequirePermissions('dashboard.read')
  async company() {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'company' } });
    return setting?.value ?? null;
  }

  @Put('settings/company')
  @RequirePermissions('settings.write')
  async saveCompany(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(companySchema)) dto: z.infer<typeof companySchema>,
    @Meta() meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: 'company' },
        update: { value: dto, updatedBy: auth.sub },
        create: { key: 'company', value: dto, updatedBy: auth.sub },
      });
      await this.audit.record(
        {
          actorId: auth.sub,
          action: 'settings.company-changed',
          entity: 'setting',
          entityId: 'company',
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    return dto;
  }

  private async role(key: string) {
    const role = await this.prisma.role.findUnique({ where: { key } });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', title: 'Choose a role' });
    return role;
  }

  private async member(id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, type: 'STAFF', deletedAt: null } });
    if (!user) throw new NotFoundException({ code: 'STAFF_NOT_FOUND', title: 'Staff member not found' });
    return user;
  }
}
