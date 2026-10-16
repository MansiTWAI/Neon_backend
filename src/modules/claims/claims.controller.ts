import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { ClaimEvidence } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Meta, type RequestMeta } from '../../common/http/request-meta';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import {
  ApproveClaimDto,
  approveClaimSchema,
  ClaimListQuery,
  claimListSchema,
  cleanFileName,
  CreateClaimDto,
  createClaimSchema,
  MAX_EVIDENCE_BYTES,
  ReviewNoteDto,
  reviewNoteSchema,
  sniffEvidence,
  SubmitClaimDto,
  submitClaimSchema,
} from './claims.dto';
import { ClaimsService, EvidenceFile } from './claims.service';

const id = new ParseUUIDPipe();

/** One file per request, checked by its bytes. */
async function readEvidence(request: FastifyRequest): Promise<EvidenceFile> {
  const part = await request.file().catch(() => undefined);
  if (!part) throw new BadRequestException({ code: 'FILE_REQUIRED', title: 'Choose a file to upload' });
  const body = await part.toBuffer().catch(() => null);
  if (!body || part.file.truncated || body.length > MAX_EVIDENCE_BYTES) {
    throw new BadRequestException({ code: 'FILE_TOO_LARGE', title: 'Files can be up to 5 MB' });
  }
  const mime = sniffEvidence(body);
  if (!mime) {
    throw new BadRequestException({
      code: 'UNSUPPORTED_FILE',
      title: 'Upload the statement or receipt as a PDF, JPG, PNG or WebP',
    });
  }
  return { body, mime, fileName: cleanFileName(part.filename, mime) };
}

/**
 * Bank statements are private: never cached, never at a public address, and shown in a sandbox so
 * a crafted PDF cannot run script against the API's origin.
 */
function sendEvidence(reply: FastifyReply, evidence: ClaimEvidence) {
  return reply
    .header('content-type', evidence.mime)
    .header('content-length', evidence.bytes)
    .header('content-disposition', `inline; filename="${evidence.fileName}"`)
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .header(
      'content-security-policy',
      "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    )
    .header('cross-origin-resource-policy', 'same-site')
    .send(Buffer.from(evidence.data));
}

/** A franchise's own claims. Every query is scoped to the caller's franchise. */
@Controller('partner/claims')
@Authenticated(['franchise'])
export class PartnerClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  list(@CurrentAuth() auth: AccessClaims) {
    return this.claims.partnerClaims(auth.fid!);
  }

  @Post()
  create(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(createClaimSchema)) dto: CreateClaimDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.claims.createDraft(auth.sub, auth.fid!, dto, meta);
  }

  @Get(':id')
  get(@CurrentAuth() auth: AccessClaims, @Param('id', id) claimId: string) {
    return this.claims.partnerClaim(auth.fid!, claimId);
  }

  @Delete(':id')
  discard(@CurrentAuth() auth: AccessClaims, @Param('id', id) claimId: string, @Meta() meta: RequestMeta) {
    return this.claims.discard(auth.sub, auth.fid!, claimId, meta);
  }

  @Post(':id/evidence')
  async addEvidence(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) claimId: string,
    @Req() request: FastifyRequest,
    @Meta() meta: RequestMeta,
  ) {
    return this.claims.addEvidence(auth.sub, auth.fid!, claimId, await readEvidence(request), meta);
  }

  @Get(':id/evidence/:evidenceId')
  async evidence(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) claimId: string,
    @Param('evidenceId', id) evidenceId: string,
    @Res() reply: FastifyReply,
  ) {
    return sendEvidence(reply, await this.claims.evidenceFile(claimId, evidenceId, auth.fid!));
  }

  @Delete(':id/evidence/:evidenceId')
  removeEvidence(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) claimId: string,
    @Param('evidenceId', id) evidenceId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.claims.removeEvidence(auth.sub, auth.fid!, claimId, evidenceId, meta);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) claimId: string,
    @Body(new ZodValidationPipe(submitClaimSchema)) dto: SubmitClaimDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.claims.submit(auth.sub, auth.fid!, claimId, dto, meta);
  }
}

/** The accounts team's review of claims. */
@Controller('admin/claims')
@Authenticated(['admin'])
export class AdminClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @RequirePermissions('commission.read')
  list(@Query(new ZodValidationPipe(claimListSchema)) query: ClaimListQuery) {
    return this.claims.adminClaims(query);
  }

  @Get(':id')
  @RequirePermissions('commission.read')
  get(@Param('id', id) claimId: string) {
    return this.claims.adminClaim(claimId);
  }

  /** Bank statements hold more than the claim needs, so only reviewers may open them. */
  @Get(':id/evidence/:evidenceId')
  @RequirePermissions('claims.review')
  async evidence(
    @Param('id', id) claimId: string,
    @Param('evidenceId', id) evidenceId: string,
    @Res() reply: FastifyReply,
  ) {
    return sendEvidence(reply, await this.claims.evidenceFile(claimId, evidenceId));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('claims.review')
  approve(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) claimId: string,
    @Body(new ZodValidationPipe(approveClaimSchema)) dto: ApproveClaimDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.claims.approve(auth.sub, claimId, dto, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('claims.review')
  reject(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) claimId: string,
    @Body(new ZodValidationPipe(reviewNoteSchema)) dto: ReviewNoteDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.claims.reject(auth.sub, claimId, dto, meta);
  }

  @Post(':id/dispute')
  @HttpCode(200)
  @RequirePermissions('claims.review')
  dispute(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) claimId: string,
    @Body(new ZodValidationPipe(reviewNoteSchema)) dto: ReviewNoteDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.claims.dispute(auth.sub, claimId, dto, meta);
  }
}
