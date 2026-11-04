import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { COOKIE_CSRF, CSRF_HEADER } from '../cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfTokensMatch(cookieValue: unknown, headerValue: unknown): boolean {
  if (typeof cookieValue !== 'string' || typeof headerValue !== 'string') return false;
  if (cookieValue.length < 16 || cookieValue.length !== headerValue.length) return false;
  return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(headerValue));
}

/**
 * Double-submit-cookie CSRF protection for every state-changing request.
 * Combined with SameSite cookies and a strict CORS allow-list this blocks cross-site
 * requests that would otherwise ride on the user's auth cookies.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

    const cookie = (req.cookies as Record<string, unknown> | undefined)?.[COOKIE_CSRF];
    if (!csrfTokensMatch(cookie, req.header(CSRF_HEADER))) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }
    return true;
  }
}
