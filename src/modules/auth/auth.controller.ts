import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuthCookies } from './auth-cookies';
import { AllowWithoutTwoFactor, Authenticated, CurrentAuth } from './auth.decorators';
import {
  EnableTwoFactorDto,
  enableTwoFactorSchema,
  PasswordLoginDto,
  passwordLoginSchema,
  RequestOtpDto,
  requestOtpSchema,
  SecondFactorDto,
  secondFactorSchema,
  UpdateProfileDto,
  updateProfileSchema,
  VerifyOtpDto,
  verifyOtpSchema,
} from './auth.dto';
import { AuthService, SignedIn } from './auth.service';
import { AccessClaims, Audience, audienceSchema, PASSWORD_AUDIENCES, PHONE_AUDIENCES } from './auth.types';
import { ClientInfo } from './session.service';

const phoneAudience = new ZodValidationPipe(z.enum(PHONE_AUDIENCES));
const passwordAudience = new ZodValidationPipe(z.enum(PASSWORD_AUDIENCES));
const anyAudience = new ZodValidationPipe(audienceSchema);

function clientOf(request: FastifyRequest): ClientInfo {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@Controller('auth/:audience')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Post('otp')
  @HttpCode(202)
  requestOtp(
    @Param('audience', phoneAudience) audience: Audience,
    @Body(new ZodValidationPipe(requestOtpSchema)) { phone }: RequestOtpDto,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.requestOtp(audience, phone, request.ip);
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Param('audience', phoneAudience) audience: Audience,
    @Body(new ZodValidationPipe(verifyOtpSchema)) dto: VerifyOtpDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(reply, audience, await this.auth.verifyOtp(audience, dto, clientOf(request)));
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Param('audience', passwordAudience) audience: Audience,
    @Body(new ZodValidationPipe(passwordLoginSchema)) dto: PasswordLoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.passwordLogin(audience, dto, clientOf(request));
    return 'twoFactorRequired' in result ? result : this.respond(reply, audience, result);
  }

  @Post('2fa/verify')
  @HttpCode(200)
  async verifySecondFactor(
    @Param('audience', passwordAudience) audience: Audience,
    @Body(new ZodValidationPipe(secondFactorSchema)) dto: SecondFactorDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(
      reply,
      audience,
      await this.auth.verifySecondFactor(audience, dto, clientOf(request)),
    );
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @Authenticated('route')
  @AllowWithoutTwoFactor()
  startTwoFactorSetup(@CurrentAuth() auth: AccessClaims) {
    return this.auth.startTwoFactorSetup(auth);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @Authenticated('route')
  @AllowWithoutTwoFactor()
  async enableTwoFactor(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(enableTwoFactorSchema)) dto: EnableTwoFactorDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(reply, auth.aud, await this.auth.enableTwoFactor(auth, dto, clientOf(request)));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Param('audience', anyAudience) audience: Audience,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = this.cookies.refreshToken(request, audience);
    if (!token) throw new UnauthorizedException({ code: 'SESSION_EXPIRED', title: 'Please sign in again' });

    try {
      return this.respond(reply, audience, await this.auth.refresh(audience, token, clientOf(request)));
    } catch (error) {
      this.cookies.clear(reply, audience);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @Authenticated('route')
  @AllowWithoutTwoFactor()
  async logout(@CurrentAuth() auth: AccessClaims, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(auth.sid);
    this.cookies.clear(reply, auth.aud);
  }

  @Get('me')
  @Authenticated('route')
  @AllowWithoutTwoFactor()
  me(@CurrentAuth() auth: AccessClaims) {
    return this.auth.profile(auth);
  }

  @Patch('me')
  @Authenticated(['customer'])
  updateProfile(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ) {
    return this.auth.updateCustomerProfile(auth, dto);
  }

  @Delete('me')
  @HttpCode(204)
  @Authenticated(['customer'])
  async deleteAccount(@CurrentAuth() auth: AccessClaims, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.deleteCustomer(auth);
    this.cookies.clear(reply, auth.aud);
  }

  private respond(reply: FastifyReply, audience: Audience, signedIn: SignedIn) {
    this.cookies.set(reply, audience, signedIn.accessToken, signedIn.refreshToken, signedIn.refreshExpiresAt);
    return { user: signedIn.profile };
  }
}
