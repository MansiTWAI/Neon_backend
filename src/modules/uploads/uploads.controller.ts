import { BadRequestException, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../../database/prisma.service';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { sniffImage, StorageService } from '../storage/storage.service';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@Controller('uploads')
@Authenticated(['customer'])
export class UploadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** A customer's logo, sent as multipart/form-data with a single `file` field. */
  @Post('logo')
  @HttpCode(201)
  async logo(@CurrentAuth() auth: AccessClaims, @Req() request: FastifyRequest) {
    const part = await request.file().catch(() => undefined);
    if (!part) throw new BadRequestException({ code: 'FILE_REQUIRED', title: 'Choose a file to upload' });

    const body = await part.toBuffer().catch(() => null);
    if (!body || part.file.truncated) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', title: 'Files can be up to 10 MB' });
    }
    const type = sniffImage(body);
    if (!type) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        title: 'Upload a PNG, JPG or WebP image of your logo',
      });
    }

    const key = await this.storage.put('logos', body, type);
    const upload = await this.prisma.upload.create({
      data: {
        ownerUserId: auth.sub,
        kind: 'LOGO',
        s3Key: key,
        mime: type,
        bytes: body.length,
        status: 'READY',
      },
      select: { id: true },
    });
    return { id: upload.id, url: this.storage.url(key) };
  }
}
