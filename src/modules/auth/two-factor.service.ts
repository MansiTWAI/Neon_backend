import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { decrypt, encrypt } from '../../common/security/crypto';
import { Env } from '../../config/env';

const ISSUER = 'Neon Adda';

@Injectable()
export class TwoFactorService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const encodedKey: string = config.get('ENCRYPTION_KEY', { infer: true });
    this.key = Buffer.from(encodedKey, 'base64');
  }

  async createSecret(accountLabel: string) {
    const secret = new Secret({ size: 20 });
    const uri = this.totp(secret.base32, accountLabel).toString();
    return {
      secret: secret.base32,
      uri,
      qrCodeDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }),
    };
  }

  /** Accepts the current code and the ones either side of it, to tolerate clock drift. */
  verify(secretBase32: string, code: string): boolean {
    return this.totp(secretBase32).validate({ token: code, window: 1 }) !== null;
  }

  seal(secretBase32: string): Buffer {
    return encrypt(secretBase32, this.key);
  }

  unseal(sealed: Uint8Array): string {
    return decrypt(sealed, this.key);
  }

  private totp(secretBase32: string, label = 'account') {
    return new TOTP({
      issuer: ISSUER,
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: secretBase32,
    });
  }
}
