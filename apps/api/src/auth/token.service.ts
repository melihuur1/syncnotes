import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import type { AccessTokenClaims } from '../common/auth-user';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 256-bit URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.JWT_ACCESS_SECRET,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      algorithm: 'HS256',
    });
  }

  /** Opaque refresh token; only its SHA-256 hash is persisted. */
  createRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    return { token, hash: sha256(token), expiresAt };
  }
}
