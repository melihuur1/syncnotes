import { ExecutionContext, SetMetadata } from '@nestjs/common';

export const AUTH_RATE_LIMIT_KEY = 'syncnotes:authRateLimit';

/** Applies the stricter `auth` throttler (per IP) to credential endpoints. */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

export function isAuthRateLimited(context: ExecutionContext): boolean {
  return Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, context.getHandler()) === true;
}
