import type {
  AuthResponse,
  CollabTicketDto,
  FolderDto,
  MemberDto,
  NoteDetailDto,
  NoteSummaryDto,
  PublicUser,
  VersionDetailDto,
  VersionSummaryDto,
} from '@syncnotes/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** True for failures where the server answered (as opposed to being unreachable). */
export function isApiError(err: unknown, status?: number): err is ApiError {
  return err instanceof ApiError && (status === undefined || err.status === status);
}

const CSRF_COOKIE = 'sn_csrf';
const CSRF_HEADER = 'x-csrf-token';
const BASE = '/api';

let onSessionExpired: (() => void) | undefined;
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  const fromCookie = readCookie(CSRF_COOKIE);
  if (fromCookie) return decodeURIComponent(fromCookie);
  csrfPromise ??= fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
    .then((r) => r.json() as Promise<{ csrfToken: string }>)
    .then((r) => r.csrfToken)
    .finally(() => (csrfPromise = null));
  return csrfPromise;
}

// Single-flight refresh: concurrent 401s share one rotation request.
let refreshPromise: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  refreshPromise ??= send('POST', '/auth/refresh', undefined, { retryOn401: false })
    .then(() => true)
    .catch(() => false)
    .finally(() => (refreshPromise = null));
  return refreshPromise;
}

interface SendOptions {
  retryOn401?: boolean;
}

async function send<T>(
  method: string,
  path: string,
  body?: unknown,
  options: SendOptions = {},
): Promise<T> {
  const { retryOn401 = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers[CSRF_HEADER] = await csrfToken();

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && retryOn401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) return send<T>(method, path, body, { retryOn401: false });
    onSessionExpired?.();
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => undefined)) as
      { message?: string | string[] } | undefined;
    let message = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : (payload?.message ?? res.statusText);
    if (res.status === 429 && /throttler/i.test(message)) {
      message = 'Too many requests. Please wait a moment and try again.';
    }
    throw new ApiError(res.status, message, payload);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : '';
};

export interface NoteFilters {
  scope?: 'all' | 'owned' | 'shared';
  folderId?: string;
  q?: string;
}

export const api = {
  auth: {
    me: async (): Promise<PublicUser | null> => {
      try {
        return await send<PublicUser>('GET', '/auth/me');
      } catch (err) {
        if (isApiError(err, 401)) {
          if (await refreshSession()) return send<PublicUser>('GET', '/auth/me');
          return null;
        }
        throw err;
      }
    },
    login: (email: string, password: string) =>
      send<AuthResponse>('POST', '/auth/login', { email, password }),
    register: (name: string, email: string, password: string) =>
      send<AuthResponse>('POST', '/auth/register', { name, email, password }),
    logout: () => send<void>('POST', '/auth/logout'),
  },
  notes: {
    list: (filters: NoteFilters = {}) =>
      send<NoteSummaryDto[]>('GET', `/notes${qs({ ...filters })}`),
    create: (folderId?: string) =>
      send<NoteSummaryDto>('POST', '/notes', folderId ? { folderId } : {}),
    get: (noteId: string) => send<NoteDetailDto>('GET', `/notes/${noteId}`),
    move: (noteId: string, folderId: string | null) =>
      send<NoteSummaryDto>('PATCH', `/notes/${noteId}/folder`, { folderId }),
    remove: (noteId: string) => send<void>('DELETE', `/notes/${noteId}`),
    leave: (noteId: string) => send<void>('POST', `/notes/${noteId}/leave`),
    collabTicket: (noteId: string) =>
      send<CollabTicketDto>('POST', `/notes/${noteId}/collab-ticket`),
  },
  folders: {
    list: () => send<FolderDto[]>('GET', '/folders'),
    create: (name: string) => send<FolderDto>('POST', '/folders', { name }),
    rename: (folderId: string, name: string) =>
      send<FolderDto>('PATCH', `/folders/${folderId}`, { name }),
    remove: (folderId: string) => send<void>('DELETE', `/folders/${folderId}`),
  },
  members: {
    list: (noteId: string) => send<MemberDto[]>('GET', `/notes/${noteId}/members`),
    invite: (noteId: string, email: string, role: 'EDITOR' | 'VIEWER') =>
      send<MemberDto>('POST', `/notes/${noteId}/members`, { email, role }),
    update: (noteId: string, userId: string, role: 'EDITOR' | 'VIEWER') =>
      send<MemberDto>('PATCH', `/notes/${noteId}/members/${userId}`, { role }),
    remove: (noteId: string, userId: string) =>
      send<void>('DELETE', `/notes/${noteId}/members/${userId}`),
  },
  versions: {
    list: (noteId: string) => send<VersionSummaryDto[]>('GET', `/notes/${noteId}/versions`),
    get: (noteId: string, versionId: string) =>
      send<VersionDetailDto>('GET', `/notes/${noteId}/versions/${versionId}`),
  },
};
