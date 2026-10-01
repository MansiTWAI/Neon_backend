import { toApiError, type Audience, type Profile } from './audience';

export { ApiError, toApiError, type Audience, type Profile } from './audience';
export {
  enablePushNotifications,
  firebaseConfigFromEnv,
  pushSupport,
  type FirebaseWebConfig,
  type PushOutcome,
} from './push';

export interface BrowserApi {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  signOut(): Promise<void>;
}

/**
 * Fetch wrapper for browser code. Sends the httpOnly session cookies, and on an expired
 * access token refreshes the session once and retries.
 */
export function createBrowserApi(audience: Audience, apiUrl: string): BrowserApi {
  let refreshing: Promise<boolean> | null = null;

  const refresh = () =>
    (refreshing ??= fetch(`${apiUrl}/v1/auth/${audience}/refresh`, { method: 'POST', credentials: 'include' })
      .then((res) => res.ok)
      .finally(() => {
        refreshing = null;
      }));

  async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const res = await fetch(`${apiUrl}/v1${path}`, {
      ...init,
      credentials: 'include',
      // FormData bodies set their own multipart boundary, so only string bodies are labelled as JSON.
      headers: {
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    if (res.status === 401 && retry && !path.startsWith('/auth/')) {
      if (await refresh()) return request<T>(path, init, false);
    }
    if (!res.ok) throw await toApiError(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  return {
    request,
    async signOut() {
      await request<void>(`/auth/${audience}/logout`, { method: 'POST' }).catch(() => undefined);
    },
  };
}

export type SignInResult = { user: Profile } | { twoFactorRequired: true; challenge: string };
