import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { StorageService } from './storage.service';

@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Get('*')
  async file(@Param('*') key: string, @Res() reply: FastifyReply) {
    const file = await this.storage.get(key);
    if (!file) throw new NotFoundException({ code: 'FILE_NOT_FOUND', title: 'File not found' });

    // Keys are content-addressed by a random id and never overwritten.
    return reply
      .header('content-type', file.contentType)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(file.body);
  }
}
