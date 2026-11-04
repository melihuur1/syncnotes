import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setSessionExpiredHandler } from './api';

type Call = { url: string; init: RequestInit };

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api client', () => {
  let calls: Call[];
  let responses: Array<(call: Call) => Response>;

  beforeEach(() => {
    calls = [];
    responses = [];
    document.cookie = 'sn_csrf=csrf-token-1234567890abcdef; path=/';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const call = { url, init };
        calls.push(call);
        const next = responses.shift();
        if (!next) throw new Error(`unexpected request ${init.method ?? 'GET'} ${url}`);
        return next(call);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends cookies and the CSRF header on state-changing requests only', async () => {
    responses.push(
      () => json(200, []),
      () => json(201, { id: 'n1' }),
    );
    await api.notes.list();
    await api.notes.create();

    expect(calls[0]!.init.credentials).toBe('include');
    expect((calls[0]!.init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
    expect((calls[1]!.init.headers as Record<string, string>)['x-csrf-token']).toBe(
      'csrf-token-1234567890abcdef',
    );
  });

  it('refreshes the session once on 401 and retries the request', async () => {
    responses.push(
      () => json(401, { message: 'expired' }),
      (c) => {
        expect(c.url).toBe('/api/auth/refresh');
        return json(200, { user: { id: 'u1' } });
      },
      () => json(200, [{ id: 'f1' }]),
    );
    await expect(api.folders.list()).resolves.toEqual([{ id: 'f1' }]);
    expect(calls.map((c) => c.url)).toEqual(['/api/folders', '/api/auth/refresh', '/api/folders']);
  });

  it('shares one refresh between concurrent 401s', async () => {
    responses.push(
      () => json(401),
      () => json(401),
      () => json(200, { user: { id: 'u1' } }),
      () => json(200, []),
      () => json(200, []),
    );
    await Promise.all([api.notes.list(), api.folders.list()]);
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('signals an expired session when the refresh fails', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    responses.push(
      () => json(401),
      () => json(401, { message: 'reuse detected' }),
      () => json(401, { message: 'Not authenticated' }),
    );
    await expect(api.notes.list()).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledOnce();
  });

  it('surfaces validation messages from the API', async () => {
    responses.push(() =>
      json(400, { statusCode: 400, message: ['email must be a valid e-mail address'] }),
    );
    await expect(api.auth.login('x', 'y')).rejects.toMatchObject({
      status: 400,
      message: 'email must be a valid e-mail address',
    });
  });
});
