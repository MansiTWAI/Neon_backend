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
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { SaveDesignDto, saveDesignSchema } from './design.dto';
import { DesignsService } from './designs.service';

const withProduct = { product: { select: { slug: true, name: true, type: true } } } as const;
const shareSlug = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9]{10}$/));
const MAX_SAVED = 50;

@Controller('designs')
export class DesignsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly designs: DesignsService,
  ) {}

  @Get()
  @Authenticated(['customer'])
  async saved(@CurrentAuth() auth: AccessClaims) {
    const designs = await this.prisma.design.findMany({
      where: { userId: auth.sub, isSaved: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_SAVED,
      include: withProduct,
    });
    return designs.map((design) => this.designs.toView(design));
  }

  @Post()
  @Authenticated(['customer'])
  async save(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(saveDesignSchema)) dto: SaveDesignDto,
  ) {
    const { preview, name, ...design } = dto;
    await this.designs.resolve([{ design, qty: 1 }]);
    await this.designs.assertLogoOwned(auth.sub, design);

    const count = await this.prisma.design.count({ where: { userId: auth.sub, isSaved: true } });
    if (count >= MAX_SAVED) {
      throw new ConflictException({
        code: 'TOO_MANY_DESIGNS',
        title: `You can keep up to ${MAX_SAVED} designs. Delete one to save this.`,
      });
    }

    const previewKey = await this.designs.storePreview(preview);
    const { id } = await this.designs.create(this.prisma, auth.sub, design, {
      previewKey,
      saved: true,
      name,
    });
    return this.designs.toView(
      await this.prisma.design.findUniqueOrThrow({ where: { id }, include: withProduct }),
    );
  }

  /** Designs stay in the database because orders may refer to them; they only leave the list. */
  @Delete(':id')
  @HttpCode(204)
  @Authenticated(['customer'])
  async remove(@CurrentAuth() auth: AccessClaims, @Param('id', ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.design.updateMany({
      where: { id, userId: auth.sub, isSaved: true },
      data: { isSaved: false },
    });
    if (!count) throw notFound();
  }

  @Post(':id/share')
  @HttpCode(200)
  @Authenticated(['customer'])
  async share(@CurrentAuth() auth: AccessClaims, @Param('id', ParseUUIDPipe) id: string) {
    const design = await this.prisma.design.findFirst({
      where: { id, userId: auth.sub, mode: 'TEXT' },
      select: { shareSlug: true },
    });
    if (!design) throw notFound();
    if (design.shareSlug) return { slug: design.shareSlug };

    const slug = this.designs.newShareSlug();
    await this.prisma.design.update({ where: { id }, data: { shareSlug: slug } });
    return { slug };
  }

  /** Public: anyone with the link can see the sign and start their own from it. */
  @Get('shared/:slug')
  async shared(@Param('slug', shareSlug) slug: string) {
    const design = await this.prisma.design.findUnique({ where: { shareSlug: slug }, include: withProduct });
    if (!design || design.mode !== 'TEXT') throw notFound();
    const { id: _id, ...view } = this.designs.toView(design);
    return view;
  }
}

function notFound() {
  return new NotFoundException({ code: 'DESIGN_NOT_FOUND', title: 'This design could not be found' });
}
