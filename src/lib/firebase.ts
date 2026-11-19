import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { isOfflineFirestoreError, setServerUnreachable } from './firebaseSync.ts';

const app = initializeApp(firebaseConfig);

export const analyticsReady = isAnalyticsSupported()
  .then((supported) => (supported ? getAnalytics(app) : null))
  .catch(() => null);

function createFirestore(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestore();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isOfflineFirestoreError(error)) {
    setServerUnreachable(true);
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatUserFriendlyError(err: unknown): string {
  if (!(err instanceof Error)) return 'Something went wrong. Please try again.';
  const authCode = (err as Error & { code?: string }).code || '';
  const authMessage = err.message.toUpperCase();
  if (authCode === 'auth/configuration-not-found' || authMessage.includes('CONFIGURATION_NOT_FOUND')) {
    return 'Google sign-in is not configured in Firebase for project “babagiwafarm”. In Firebase Console, open Authentication → Sign-in method, enable Google, choose a support email, and save. Then open Authentication → Settings → Authorized domains and add localhost and 127.0.0.1 for local testing, plus your deployed app domain.';
  }
  if (authCode === 'auth/unauthorized-domain') {
    return 'This app domain is not authorized for Firebase Authentication. In Firebase Console, open Authentication → Settings → Authorized domains and add the hostname you are using (for example, localhost or 127.0.0.1).';
  }
  if (authCode === 'auth/operation-not-allowed') {
    return 'Google sign-in is disabled for Firebase project “babagiwafarm”. In Firebase Console, open Authentication → Sign-in method, enable Google, choose a support email, and save.';
  }
  try {
    const parsed = JSON.parse(err.message) as Partial<FirestoreErrorInfo>;
    if (parsed && typeof parsed.error === 'string') {
      if (parsed.error.toLowerCase().includes('permission') || parsed.error.includes('insufficient')) {
        return 'You do not have permission to perform this action.';
      }
      if (parsed.error.toLowerCase().includes('offline') || parsed.error.toLowerCase().includes('network')) {
        return 'Unable to connect. Please check your internet connection and try again.';
      }
      if (/invitation|email does not match|verified email/i.test(parsed.error)) {
        return parsed.error;
      }
      return 'Something went wrong while saving your information. Please try again.';
    }
  } catch {
    // Plain error message
  }
  if (authCode === 'auth/email-already-in-use') return 'This email address is already registered.';
  if (authCode === 'auth/invalid-email') return 'Please enter a valid email address.';
  if (authCode === 'auth/network-request-failed') return 'Unable to connect. Please check your internet connection and try again.';
  if (/permission-denied|insufficient permissions/i.test(err.message)) return 'You do not have permission to perform this action.';
  if (/network|offline|failed to fetch/i.test(err.message)) return 'Unable to connect. Please check your internet connection and try again.';
  if (/invalid invitation|expired invitation|already been accepted|email does not match/i.test(err.message)) return err.message;
  return 'Something went wrong. Please try again.';
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    setServerUnreachable(false);
    return true;
  } catch (error) {
    if (isOfflineFirestoreError(error)) {
      setServerUnreachable(true);
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error('Please check your Firebase configuration.');
      }
      return false;
    }
    // Permission denied or non-offline response still confirms server reachability
    setServerUnreachable(false);
    return true;
  }
}

void testConnection();

