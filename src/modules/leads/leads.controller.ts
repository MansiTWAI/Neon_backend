import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { indianMobileSchema } from '../auth/auth.dto';
import { pincodeSchema } from '../pricing/pricing.dto';

const leadSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  phone: indianMobileSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(120)
    .or(z.literal('').transform(() => undefined))
    .optional(),
  pincode: pincodeSchema.or(z.literal('').transform(() => undefined)).optional(),
  message: z.string().trim().min(5, 'Tell us a little about what you need').max(2000),
  source: z.enum(['CONTACT', 'BUSINESS', 'FRANCHISE_ENQUIRY']).default('CONTACT'),
});
type LeadDto = z.infer<typeof leadSchema>;

const WINDOW_MS = 60 * 60 * 1000;
const PER_WINDOW = 5;

/** Public enquiry form. Leads in a franchise's pincodes go straight to that franchise. */
@Controller('leads')
export class LeadsController {
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(201)
  async create(@Body(new ZodValidationPipe(leadSchema)) dto: LeadDto, @Req() request: FastifyRequest) {
    this.throttle(request.ip);

    const territory = dto.pincode
      ? await this.prisma.franchiseTerritory.findUnique({
          where: { pincode: dto.pincode },
          select: { franchiseId: true },
        })
      : null;
    await this.prisma.lead.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        pincode: dto.pincode,
        message: dto.message,
        source: dto.source,
        franchiseId: territory?.franchiseId,
      },
    });
    return { received: true };
  }

  /** Enough to stop a form being scripted; the edge proxy does the real rate limiting. */
  private throttle(ip: string) {
    const now = Date.now();
    const hits = (this.recent.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
    if (hits.length >= PER_WINDOW) {
      throw new HttpException(
        { code: 'TOO_MANY_REQUESTS', title: 'We have your messages. Our team will call you shortly.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.recent.set(ip, [...hits, now]);
  }
}
