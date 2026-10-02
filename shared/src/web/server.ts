import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { accessCookie, refreshCookie, toApiError, type Audience, type Profile } from './audience';
import type { FirebaseWebConfig } from './push';

export { firebaseConfigFromEnv } from './push';

export { ApiError, type Audience, type Profile } from './audience';

interface SessionOptions {
  audience: Audience;
  apiUrl: string;
  loginPath?: string;
  /** Paths reachable without a session, e.g. the login page. */
  publicPaths?: string[];
  /** Paths that need a session; everything else is public. Takes precedence over publicPaths. */
  protectedPaths?: string[];
}

const matches = (pathname: string, paths: string[]) =>
  paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/**
 * Next.js middleware that keeps the session alive: when the short-lived access cookie has
 * expired it refreshes the session before the page renders, and sends visitors without a
 * session to the login page.
 */
export function createSessionMiddleware({
  audience,
  apiUrl,
  loginPath = '/login',
  publicPaths = [loginPath],
  protectedPaths,
}: SessionOptions) {
  return async function middleware(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    const needsSession = protectedPaths ? matches(pathname, protectedPaths) : !matches(pathname, publicPaths);
    if (!needsSession || request.cookies.has(accessCookie(audience))) return NextResponse.next();

    const refreshToken = request.cookies.get(refreshCookie(audience))?.value;
    if (refreshToken) {
      const res = await fetch(`${apiUrl}/v1/auth/${audience}/refresh`, {
        method: 'POST',
        headers: { cookie: `${refreshCookie(audience)}=${refreshToken}` },
      });
      if (res.ok) return continueWithCookies(request, res.headers.getSetCookie());
    }

    const login = new URL(loginPath, request.url);
    login.searchParams.set('next', pathname + search);
    return NextResponse.redirect(login);
  };
}

/** Forwards refreshed cookies to the browser and to the page rendering this request. */
function continueWithCookies(request: NextRequest, setCookies: string[]) {
  const updated = new Map(request.cookies.getAll().map(({ name, value }) => [name, value]));
  for (const header of setCookies) {
    const [pair] = header.split(';');
    const separator = pair!.indexOf('=');
    updated.set(pair!.slice(0, separator), pair!.slice(separator + 1));
  }

  const headers = new Headers(request.headers);
  headers.set('cookie', [...updated].map(([name, value]) => `${name}=${value}`).join('; '));

  const response = NextResponse.next({ request: { headers } });
  for (const header of setCookies) response.headers.append('set-cookie', header);
  return response;
}

interface ServerApiOptions {
  audience: Audience;
  apiUrl: string;
  loginPath?: string;
  /** Where to send admins who still have to set up two-factor authentication. */
  twoFactorSetupPath?: string;
}

/** Fetch wrapper for server components and route handlers, authenticated as the current user. */
export function createServerApi({
  audience,
  apiUrl,
  loginPath = '/login',
  twoFactorSetupPath,
}: ServerApiOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = (await cookies()).get(accessCookie(audience))?.value;
    if (!token) redirect(loginPath);

    const res = await fetch(`${apiUrl}/v1${path}`, {
      ...init,
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    });

    if (res.status === 401) redirect(loginPath);
    if (!res.ok) {
      const error = await toApiError(res);
      if (error.code === 'TWO_FACTOR_SETUP_REQUIRED' && twoFactorSetupPath) redirect(twoFactorSetupPath);
      throw error;
    }
    return (await res.json()) as T;
  }

  return {
    request,
    /**
     * Whether the browser holds a session, without asking the API. An expired access token with a
     * live refresh token still counts: the browser client refreshes it on its next request.
     */
    async hasSession(): Promise<boolean> {
      const jar = await cookies();
      return jar.has(accessCookie(audience)) || jar.has(refreshCookie(audience));
    },
    /** The signed-in user, or null when there is no valid session. Never redirects. */
    async profile(): Promise<Profile | null> {
      const token = (await cookies()).get(accessCookie(audience))?.value;
      if (!token) return null;
      const res = await fetch(`${apiUrl}/v1/auth/${audience}/me`, {
        cache: 'no-store',
        headers: { authorization: `Bearer ${token}` },
      });
      return res.ok ? ((await res.json()) as Profile) : null;
    },
  };
}

/**
 * Source of the Firebase Messaging service worker. Served from a route handler so the
 * public Firebase configuration comes from environment variables instead of being committed.
 */
export function firebaseServiceWorkerSource(
  config: FirebaseWebConfig | null,
  sdkVersion = '12.19.0',
): string {
  if (!config) return '// Push notifications are not configured.\n';
  const { vapidKey: _vapidKey, ...options } = config;

  return `importScripts('https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-messaging-compat.js');

firebase.initializeApp(${JSON.stringify(options)});
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title = 'Neon Adda', body = '' } = payload.notification ?? {};
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: { link: payload.data?.link ?? payload.fcmOptions?.link ?? '/' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.link ?? '/'));
});
`;
}
