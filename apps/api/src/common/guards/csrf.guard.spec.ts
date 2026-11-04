import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CsrfGuard, csrfTokensMatch } from './csrf.guard';

function httpContext(method: string, cookie?: string, header?: string): ExecutionContext {
  const req = {
    method,
    cookies: cookie === undefined ? {} : { sn_csrf: cookie },
    header: (name: string) => (name === 'x-csrf-token' ? header : undefined),
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('csrfTokensMatch', () => {
  const token = 'a'.repeat(32);

  it('accepts identical tokens', () => {
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it.each([
    ['missing cookie', undefined, token],
    ['missing header', token, undefined],
    ['different value', token, 'b'.repeat(32)],
    ['different length', token, 'a'.repeat(31)],
    ['too short', 'abc', 'abc'],
  ])('rejects %s', (_label, cookie, header) => {
    expect(csrfTokensMatch(cookie, header)).toBe(false);
  });
});

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();
  const token = 'x'.repeat(32);

  it('lets safe methods through without a token', () => {
    expect(guard.canActivate(httpContext('GET'))).toBe(true);
    expect(guard.canActivate(httpContext('HEAD'))).toBe(true);
  });

  it('requires a matching header for state-changing methods', () => {
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      expect(() => guard.canActivate(httpContext(method))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(httpContext(method, token, 'y'.repeat(32)))).toThrow(
        ForbiddenException,
      );
      expect(guard.canActivate(httpContext(method, token, token))).toBe(true);
    }
  });
});
