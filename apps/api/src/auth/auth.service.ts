import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PublicUser } from '@syncnotes/shared';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';
import { PasswordService } from './password.service';
import { sha256, TokenService } from './token.service';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionMeta {
  userAgent?: string;
}

interface UserRecord {
  id: string;
  email: string;
  name: string;
}

/**
 * Window in which presenting an already-rotated refresh token is treated as a benign race
 * (two tabs refreshing at the same time) instead of token theft.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

const INVALID_CREDENTIALS = 'Invalid email or password';

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(
    dto: RegisterDto,
    meta: SessionMeta,
  ): Promise<{ user: PublicUser; tokens: SessionTokens }> {
    const existing = await this.prisma.db.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('An account with this e-mail already exists');

    const passwordHash = await this.passwords.hash(dto.password);
    let user: UserRecord;
    try {
      user = await this.prisma.db.user.create({
        data: { email: dto.email, name: dto.name, passwordHash },
        select: { id: true, email: true, name: true },
      });
    } catch (err) {
      // Unique violation from a concurrent registration with the same e-mail.
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('An account with this e-mail already exists');
      }
      throw err;
    }
    return { user: toPublicUser(user), tokens: await this.startSession(user, meta) };
  }

  async login(dto: LoginDto, meta: SessionMeta): Promise<{ user: PublicUser; tokens: SessionTokens }> {
    const user = await this.prisma.db.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      await this.passwords.verifyDummy(dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        'Too many failed login attempts. The account is temporarily locked.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      await this.registerFailedAttempt(user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    return { user: toPublicUser(user), tokens: await this.startSession(user, meta) };
  }

  /**
   * Rotates a refresh token. Every refresh token is single-use:
   * - unknown / expired / revoked → 401
   * - already rotated (outside the grace window) → treated as theft: the whole family is revoked
   */
  async refresh(
    rawToken: string | undefined,
    meta: SessionMeta,
  ): Promise<{ user: PublicUser; tokens: SessionTokens }> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');

    const session = await this.prisma.db.session.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.rotatedAt) {
      if (Date.now() - session.rotatedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
        throw new UnauthorizedException('Refresh token already rotated');
      }
      await this.revokeFamily(session.familyId);
      this.logger.warn(
        `Refresh token reuse detected for user ${session.userId}; revoked family ${session.familyId}`,
      );
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // Atomic claim: only one concurrent request can rotate a given token.
    const claimed = await this.prisma.db.session.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) throw new UnauthorizedException('Refresh token already rotated');

    return {
      user: toPublicUser(session.user),
      tokens: await this.startSession(session.user, meta, session.familyId),
    };
  }

  async logout(rawRefreshToken: string | undefined, accessFamilyId?: string): Promise<void> {
    const families = new Set<string>();
    if (accessFamilyId) families.add(accessFamilyId);
    if (rawRefreshToken) {
      const session = await this.prisma.db.session.findUnique({
        where: { tokenHash: sha256(rawRefreshToken) },
        select: { familyId: true },
      });
      if (session) families.add(session.familyId);
    }
    await Promise.all([...families].map((id) => this.revokeFamily(id)));
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.db.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async registerFailedAttempt(userId: string): Promise<void> {
    const updated = await this.prisma.db.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= this.config.LOGIN_MAX_ATTEMPTS) {
      await this.prisma.db.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(Date.now() + this.config.LOGIN_LOCK_MINUTES * 60_000),
        },
      });
      this.logger.warn(`Account ${userId} locked after repeated failed logins`);
    }
  }

  private async startSession(
    user: UserRecord,
    meta: SessionMeta,
    familyId: string = randomUUID(),
  ): Promise<SessionTokens> {
    const refresh = this.tokens.createRefreshToken();
    await this.prisma.db.session.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: refresh.hash,
        expiresAt: refresh.expiresAt,
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      sid: familyId,
      name: user.name,
      email: user.email,
    });
    return { accessToken, refreshToken: refresh.token };
  }
}
