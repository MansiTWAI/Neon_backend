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
  customerLoginSchema,
  EnableTwoFactorDto,
  enableTwoFactorSchema,
  passwordLoginSchema,
  RegisterDto,
  registerSchema,
  RequestOtpDto,
  requestOtpSchema,
  ResetPasswordDto,
  resetPasswordSchema,
  SecondFactorDto,
  secondFactorSchema,
  UpdateProfileDto,
  updateProfileSchema,
  VerifyOtpDto,
  verifyOtpSchema,
  VerifyRegistrationDto,
  verifyRegistrationSchema,
} from './auth.dto';
import { AuthService, SignedIn } from './auth.service';
import { AccessClaims, Audience, audienceSchema, PASSWORD_AUDIENCES, PHONE_AUDIENCES } from './auth.types';
import { ClientInfo } from './session.service';

const phoneAudience = new ZodValidationPipe(z.enum(PHONE_AUDIENCES));
const passwordAudience = new ZodValidationPipe(z.enum(PASSWORD_AUDIENCES));
const anyAudience = new ZodValidationPipe(audienceSchema);
const customerOnly = new ZodValidationPipe(z.literal('customer'));
const customerLogin = new ZodValidationPipe(customerLoginSchema);
const emailLogin = new ZodValidationPipe(passwordLoginSchema);

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
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const credentials =
      audience === 'customer'
        ? (({ login, password }) => ({ ...login, password }))(customerLogin.transform(body))
        : emailLogin.transform(body);
    const result = await this.auth.passwordLogin(audience, credentials, clientOf(request));
    return 'twoFactorRequired' in result ? result : this.respond(reply, audience, result);
  }

  /** What the shop's sign-in screen may offer, e.g. whether password reset works yet. */
  @Get('options')
  signInOptions(@Param('audience', customerOnly) _audience: 'customer') {
    return this.auth.customerSignInOptions();
  }

  @Post('register')
  @HttpCode(202)
  startRegistration(
    @Param('audience', customerOnly) _audience: 'customer',
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.startRegistration(dto, request.ip);
  }

  @Post('register/verify')
  @HttpCode(200)
  async completeRegistration(
    @Param('audience', customerOnly) audience: 'customer',
    @Body(new ZodValidationPipe(verifyRegistrationSchema)) dto: VerifyRegistrationDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(reply, audience, await this.auth.completeRegistration(dto, clientOf(request)));
  }

  @Post('password/forgot')
  @HttpCode(202)
  requestPasswordReset(
    @Param('audience', customerOnly) _audience: 'customer',
    @Body(new ZodValidationPipe(requestOtpSchema)) { phone }: RequestOtpDto,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.requestPasswordReset(phone, request.ip);
  }

  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(
    @Param('audience', customerOnly) audience: 'customer',
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(reply, audience, await this.auth.resetPassword(dto, clientOf(request)));
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
