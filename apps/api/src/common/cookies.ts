import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config/env';

export const COOKIE_ACCESS = 'sn_access';
export const COOKIE_REFRESH = 'sn_refresh';
export const COOKIE_CSRF = 'sn_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Refresh cookie is only ever sent to the auth endpoints. */
const REFRESH_PATH = '/api/auth';

function base(config: AppConfig): CookieOptions {
  return { secure: config.COOKIE_SECURE, sameSite: 'lax', path: '/' };
}

export function setAuthCookies(
  res: Response,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(COOKIE_ACCESS, tokens.accessToken, {
    ...base(config),
    httpOnly: true,
    maxAge: config.JWT_ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(COOKIE_REFRESH, tokens.refreshToken, {
    ...base(config),
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  res.clearCookie(COOKIE_ACCESS, { ...base(config), httpOnly: true });
  res.clearCookie(COOKIE_REFRESH, {
    ...base(config),
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_PATH,
  });
}

/** Double-submit CSRF cookie — intentionally readable by the SPA (not HttpOnly). */
export function setCsrfCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(COOKIE_CSRF, token, { ...base(config), httpOnly: false });
}
