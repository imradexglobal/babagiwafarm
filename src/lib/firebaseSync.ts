export type FirebaseSyncState = 'synced' | 'syncing' | 'offline';

export interface FirebaseSyncSnapshot {
  isOnline: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
  activeOperations: number;
  waitingForPendingWrites: boolean;
  serverUnreachable: boolean;
}

export function resolveFirebaseSyncState(snapshot: FirebaseSyncSnapshot): FirebaseSyncState {
  if (!snapshot.isOnline || snapshot.serverUnreachable) {
    return 'offline';
  }
  if (
    snapshot.hasPendingWrites ||
    snapshot.waitingForPendingWrites ||
    snapshot.activeOperations > 0 ||
    snapshot.fromCache
  ) {
    return 'syncing';
  }
  return 'synced';
}

export function isOfflineFirestoreError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  return (
    code === 'unavailable' ||
    msg.includes('client is offline') ||
    msg.includes('failed to get document because the client is offline') ||
    msg.includes('network error') ||
    msg.includes('network request failed')
  );
}

// Lightweight global pub/sub for active Firestore operations and connectivity hints
type Listener = () => void;

const listeners = new Set<Listener>();
let activeOperations = 0;
let serverUnreachable = false;

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeSyncTracker(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncTrackerState(): {
  activeOperations: number;
  serverUnreachable: boolean;
} {
  return { activeOperations, serverUnreachable };
}

export function beginFirebaseSync(): () => void {
  activeOperations += 1;
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeOperations = Math.max(0, activeOperations - 1);
    emit();
  };
}

export function setServerUnreachable(unreachable: boolean): void {
  if (serverUnreachable === unreachable) return;
  serverUnreachable = unreachable;
  emit();
}
