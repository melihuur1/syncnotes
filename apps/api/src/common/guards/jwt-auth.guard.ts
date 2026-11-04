import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessTokenClaims, AuthenticatedRequest } from '../auth-user';
import { COOKIE_ACCESS } from '../cookies';
import { IS_PUBLIC_KEY } from '../decorators';

/**
 * Global guard: every route requires a valid access-token cookie unless marked `@Public()`.
 *
 * Besides verifying the JWT signature we check that the refresh-token *family* the token was
 * minted for is still active. Logging out (or reuse detection) therefore invalidates access
 * tokens immediately instead of waiting up to `JWT_ACCESS_TTL_SECONDS` for them to expire.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[COOKIE_ACCESS];
    if (!token) throw new UnauthorizedException('Not authenticated');

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const activeSession = await this.prisma.db.session.findFirst({
      where: {
        familyId: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!activeSession) throw new UnauthorizedException('Session has been revoked');

    req.user = {
      id: claims.sub,
      name: claims.name,
      email: claims.email,
      sessionFamilyId: claims.sid,
    };
    return true;
  }
}
