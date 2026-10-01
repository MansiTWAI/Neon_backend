import { Body, Controller, Delete, Get, HttpCode, Headers, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

const deviceSchema = z.object({ token: z.string().min(20).max(4096) });
type DeviceDto = z.infer<typeof deviceSchema>;

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('status')
  status() {
    return { pushEnabled: this.notifications.pushEnabled };
  }

  @Get(':audience')
  @Authenticated('route')
  inbox(@CurrentAuth() auth: AccessClaims) {
    return this.notifications.inbox(auth.sub);
  }

  @Post(':audience/read-all')
  @HttpCode(204)
  @Authenticated('route')
  async markAllRead(@CurrentAuth() auth: AccessClaims) {
    await this.notifications.markAllRead(auth.sub);
  }

  @Post(':audience/devices')
  @HttpCode(204)
  @Authenticated('route')
  async registerDevice(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(deviceSchema)) { token }: DeviceDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.notifications.registerDevice(auth.sub, auth.aud, token, userAgent);
  }

  @Delete(':audience/devices')
  @HttpCode(204)
  @Authenticated('route')
  async unregisterDevice(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(deviceSchema)) { token }: DeviceDto,
  ) {
    await this.notifications.unregisterDevice(auth.sub, token);
  }

  @Post(':audience/test')
  @HttpCode(204)
  @Authenticated('route')
  async sendTest(@CurrentAuth() auth: AccessClaims) {
    await this.notifications.notify(
      auth.sub,
      { kind: 'system.test', title: 'Notifications are on', body: 'You will be alerted here about updates.' },
      [auth.aud],
    );
  }
}
