import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthResponse, PublicUser } from '@syncnotes/shared';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/env';
import type { AccessTokenClaims, AuthUser } from '../common/auth-user';
import {
  clearAuthCookies,
  COOKIE_ACCESS,
  COOKIE_CSRF,
  COOKIE_REFRESH,
  setAuthCookies,
  setCsrfCookie,
} from '../common/cookies';
import { CurrentUser, Public } from '../common/decorators';
import { AuthRateLimit } from '../common/throttle';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto';
import { randomToken } from './token.service';

function cookies(req: Request): Record<string, string | undefined> {
  return (req.cookies as Record<string, string | undefined> | undefined) ?? {};
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Issues (or re-uses) the double-submit CSRF token. Call once on app start. */
  @Public()
  @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response): { csrfToken: string } {
    let token = cookies(req)[COOKIE_CSRF];
    if (!token || token.length < 16) {
      token = randomToken(24);
      setCsrfCookie(res, this.config, token);
    }
    return { csrfToken: token };
  }

  @Public()
  @AuthRateLimit()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.auth.register(dto, { userAgent: req.get('user-agent') });
    setAuthCookies(res, this.config, tokens);
    return { user };
  }

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.auth.login(dto, { userAgent: req.get('user-agent') });
    setAuthCookies(res, this.config, tokens);
    return { user };
  }

  @Public()
  @AuthRateLimit()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.auth.refresh(cookies(req)[COOKIE_REFRESH], {
      userAgent: req.get('user-agent'),
    });
    setAuthCookies(res, this.config, tokens);
    return { user };
  }

  /** Public so that a user with an expired access token can still log out cleanly. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const access = cookies(req)[COOKIE_ACCESS];
    let familyId: string | undefined;
    if (access) {
      // Expired tokens are fine here — we only need to know which session to revoke.
      const claims = this.jwt.decode<AccessTokenClaims | null>(access);
      familyId = typeof claims?.sid === 'string' ? claims.sid : undefined;
    }
    await this.auth.logout(cookies(req)[COOKIE_REFRESH], familyId);
    clearAuthCookies(res, this.config);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }
}
