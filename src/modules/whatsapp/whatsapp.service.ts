import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';

const GRAPH_API = 'https://graph.facebook.com';

interface CloudApiConfig {
  token: string;
  phoneNumberId: string;
  template: string;
  language: string;
  version: string;
}

/**
 * Sends one-time codes through the WhatsApp Business Cloud API using an approved
 * authentication template. Until the Meta credentials are configured the service runs in
 * preview mode: nothing is sent and the code is handed back so sign-in still works.
 */
@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly cloud: CloudApiConfig | null;

  constructor(config: ConfigService<Env, true>) {
    const token = config.get('META_WA_ACCESS_TOKEN', { infer: true });
    const phoneNumberId = config.get('META_WA_PHONE_NUMBER_ID', { infer: true });
    this.cloud =
      token && phoneNumberId
        ? {
            token,
            phoneNumberId,
            template: config.get('META_WA_OTP_TEMPLATE', { infer: true }),
            language: config.get('META_WA_TEMPLATE_LANGUAGE', { infer: true }),
            version: config.get('META_GRAPH_API_VERSION', { infer: true }),
          }
        : null;
  }

  onModuleInit() {
    if (!this.cloud) {
      this.logger.warn('WhatsApp is not connected: one-time codes are shown on screen instead of sent');
    }
  }

  get inPreview(): boolean {
    return this.cloud === null;
  }

  /** @param phone E.164, e.g. +919812345678 */
  async sendOtp(phone: string, code: string): Promise<void> {
    if (!this.cloud) {
      this.logger.log(`One-time code for ${phone}: ${code}`);
      return;
    }

    const { token, phoneNumberId, template, language, version } = this.cloud;
    // Authentication templates take the code twice: in the body and in the copy-code button.
    const res = await fetch(`${GRAPH_API}/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: language },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    });

    if (!res.ok) {
      this.logger.error(`WhatsApp rejected the code for ${phone}: ${res.status} ${await res.text()}`);
      throw new ServiceUnavailableException({
        code: 'WHATSAPP_UNAVAILABLE',
        title: 'We could not send the code on WhatsApp. Try again.',
      });
    }
  }
}
