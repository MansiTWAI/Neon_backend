import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { Env } from '../../config/env';

export interface PushMessage {
  title: string;
  body: string;
  /** Path or URL opened when the notification is clicked. */
  link?: string;
  data?: Record<string, string>;
}

/** Error codes that mean a registration token will never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const APP_NAME = 'neon-adda';

@Injectable()
export class FirebaseMessagingService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseMessagingService.name);
  private messaging: Messaging | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit() {
    const projectId = this.config.get('FIREBASE_PROJECT_ID', { infer: true });
    const clientEmail = this.config.get('FIREBASE_CLIENT_EMAIL', { infer: true });
    const privateKey = this.config.get('FIREBASE_PRIVATE_KEY', { infer: true });

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.log('Firebase credentials not set; push notifications are disabled');
      return;
    }

    const app: App =
      getApps().find((existing) => existing.name === APP_NAME) ??
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, APP_NAME);
    this.messaging = getMessaging(app);
    this.logger.log(`Firebase Cloud Messaging ready for project ${projectId}`);
  }

  get enabled(): boolean {
    return this.messaging !== null;
  }

  /** Sends to every token and returns the ones Firebase says are permanently invalid. */
  async send(tokens: string[], message: PushMessage): Promise<{ delivered: number; deadTokens: string[] }> {
    if (!this.messaging || tokens.length === 0) return { delivered: 0, deadTokens: [] };

    const response = await this.messaging.sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: { ...message.data, ...(message.link ? { link: message.link } : {}) },
      webpush: {
        notification: { icon: '/icon-192.png', badge: '/badge-72.png' },
        fcmOptions: message.link ? { link: message.link } : undefined,
      },
    });

    const deadTokens = response.responses.flatMap((result, i) =>
      !result.success && result.error && DEAD_TOKEN_CODES.has(result.error.code) ? [tokens[i]!] : [],
    );
    return { delivered: response.successCount, deadTokens };
  }
}
