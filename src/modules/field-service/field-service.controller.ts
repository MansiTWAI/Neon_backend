import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { sniffImage } from '../storage/storage.service';
import {
  CompleteJobDto,
  completeJobSchema,
  FailJobDto,
  failJobSchema,
  JobListQuery,
  jobListSchema,
  JobStepDto,
  jobStepSchema,
  photoStageSchema,
} from './field-service.dto';
import { FieldServiceService } from './field-service.service';

/** The technician app. Every route is scoped to visits assigned to the signed-in technician. */
@Controller('field/jobs')
@Authenticated(['technician'])
export class FieldServiceController {
  constructor(private readonly field: FieldServiceService) {}

  @Get()
  list(@CurrentAuth() auth: AccessClaims, @Query(new ZodValidationPipe(jobListSchema)) query: JobListQuery) {
    return this.field.list(auth.tid!, query);
  }

  @Get(':id')
  detail(@CurrentAuth() auth: AccessClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.field.detail(auth.tid!, id);
  }

  @Post(':id/status')
  @HttpCode(200)
  step(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(jobStepSchema)) dto: JobStepDto,
  ) {
    return this.field.step(auth.tid!, id, dto.to);
  }

  /** One photo as multipart/form-data with a `file` field; the stage comes in the query string. */
  @Post(':id/photos')
  @HttpCode(201)
  async photo(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('stage') stage: string,
    @Req() request: FastifyRequest,
  ) {
    const parsedStage = photoStageSchema.safeParse(stage);
    if (!parsedStage.success) {
      throw new BadRequestException({
        code: 'INVALID_STAGE',
        title: 'Say whether this is before, during or after',
      });
    }
    const part = await request.file().catch(() => undefined);
    if (!part) throw new BadRequestException({ code: 'FILE_REQUIRED', title: 'Choose a photo to upload' });
    const body = await part.toBuffer().catch(() => null);
    if (!body || part.file.truncated) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', title: 'Photos can be up to 10 MB' });
    }
    const type = sniffImage(body);
    if (!type)
      throw new BadRequestException({ code: 'UNSUPPORTED_FILE', title: 'Upload a JPG, PNG or WebP photo' });
    return this.field.addPhoto(auth.tid!, id, parsedStage.data, { body, type });
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(completeJobSchema)) dto: CompleteJobDto,
  ) {
    return this.field.complete(auth.tid!, auth.sub, id, dto);
  }

  @Post(':id/fail')
  @HttpCode(200)
  fail(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(failJobSchema)) dto: FailJobDto,
  ) {
    return this.field.fail(auth.tid!, id, dto);
  }
}
