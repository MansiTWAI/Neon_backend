import { getApp, getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';

export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  /** Web push certificate key pair from Firebase > Cloud Messaging > Web configuration. */
  vapidKey: string;
}

export type PushOutcome = 'enabled' | 'denied' | 'unsupported' | 'unconfigured';

export const SERVICE_WORKER_PATH = '/firebase-messaging-sw.js';

export async function pushSupport(config: FirebaseWebConfig | null): Promise<PushOutcome | 'available'> {
  if (!config) return 'unconfigured';
  if (typeof window === 'undefined' || !('Notification' in window) || !(await isSupported()))
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'enabled' : 'available';
}

/**
 * Asks for permission, obtains this browser's FCM registration token and hands it to
 * `register`, which should store it against the signed-in user.
 */
export async function enablePushNotifications(
  config: FirebaseWebConfig | null,
  register: (token: string) => Promise<void>,
): Promise<PushOutcome> {
  const support = await pushSupport(config);
  if (support !== 'available' && support !== 'enabled') return support;

  if ((await Notification.requestPermission()) !== 'granted') return 'denied';

  const { vapidKey, ...options } = config!;
  const app = getApps().length ? getApp() : initializeApp(options);
  const serviceWorkerRegistration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration });

  await register(token);
  return 'enabled';
}

export function firebaseConfigFromEnv(env: Record<string, string | undefined>): FirebaseWebConfig | null {
  const config = {
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
    vapidKey: env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
  };
  return Object.values(config).every(Boolean) ? (config as FirebaseWebConfig) : null;
}
