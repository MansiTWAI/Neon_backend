import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { AddressDto, addressSchema } from './address.dto';

const MAX_ADDRESSES = 20;
const body = new ZodValidationPipe(addressSchema);

@Controller('me/addresses')
@Authenticated(['customer'])
export class AddressesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentAuth() auth: AccessClaims) {
    return this.prisma.address.findMany({
      where: { userId: auth.sub },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  @Post()
  async create(@CurrentAuth() auth: AccessClaims, @Body(body) dto: AddressDto) {
    const count = await this.prisma.address.count({ where: { userId: auth.sub } });
    if (count >= MAX_ADDRESSES) {
      throw new ConflictException({
        code: 'TOO_MANY_ADDRESSES',
        title: 'Delete an old address to add a new one',
      });
    }
    // The first address is the default whether or not the customer ticked the box.
    const isDefault = dto.isDefault || count === 0;

    return this.prisma.$transaction(async (tx) => {
      if (isDefault) await tx.address.updateMany({ where: { userId: auth.sub }, data: { isDefault: false } });
      return tx.address.create({ data: { ...dto, isDefault, userId: auth.sub } });
    });
  }

  @Put(':id')
  async update(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(body) dto: AddressDto,
  ) {
    await this.owned(auth.sub, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault)
        await tx.address.updateMany({ where: { userId: auth.sub }, data: { isDefault: false } });
      const { isDefault, ...fields } = dto;
      return tx.address.update({ where: { id }, data: { ...fields, ...(isDefault ? { isDefault } : {}) } });
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AccessClaims, @Param('id', ParseUUIDPipe) id: string) {
    const address = await this.owned(auth.sub, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      if (!address.isDefault) return;
      const next = await tx.address.findFirst({
        where: { userId: auth.sub },
        orderBy: { updatedAt: 'desc' },
      });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    });
  }

  private async owned(userId: string, id: string) {
    const address = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!address) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', title: 'Address not found' });
    return address;
  }
}
