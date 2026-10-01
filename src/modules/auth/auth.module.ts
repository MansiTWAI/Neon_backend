import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AuthCookies } from './auth-cookies';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

/** Global so any module can protect its routes with `@Authenticated` without importing this one. */
@Global()
@Module({
  imports: [WhatsAppModule, NotificationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookies,
    AuthGuard,
    OtpService,
    SessionService,
    TokenService,
    TwoFactorService,
  ],
  exports: [AuthGuard, SessionService, TokenService],
})
export class AuthModule {}
