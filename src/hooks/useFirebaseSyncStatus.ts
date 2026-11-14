import { useCallback, useEffect, useRef, useState } from 'react';
import { onSnapshotsInSync, waitForPendingWrites } from 'firebase/firestore';
import { db, testConnection } from '../lib/firebase.ts';
import {
  getSyncTrackerState,
  resolveFirebaseSyncState,
  setServerUnreachable,
  subscribeSyncTracker,
  type FirebaseSyncState,
} from '../lib/firebaseSync.ts';

interface UseFirebaseSyncStatusReturn {
  syncState: FirebaseSyncState;
  onFarmMetadata: (meta: { fromCache: boolean; hasPendingWrites: boolean }) => void;
}

export function useFirebaseSyncStatus(active: boolean): UseFirebaseSyncStatusReturn {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [fromCache, setFromCache] = useState<boolean>(true);
  const [hasPendingWrites, setHasPendingWrites] = useState<boolean>(false);
  const [waitingForPendingWrites, setWaitingForPendingWrites] = useState<boolean>(false);
  const [tracker, setTracker] = useState(() => getSyncTrackerState());
  const pendingCheckSeq = useRef(0);
  const pendingGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkPendingWrites = useCallback((immediate = false) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }
    const seq = ++pendingCheckSeq.current;
    if (pendingGraceTimer.current) {
      clearTimeout(pendingGraceTimer.current);
      pendingGraceTimer.current = null;
    }

    if (immediate) {
      setWaitingForPendingWrites(true);
    } else {
      pendingGraceTimer.current = setTimeout(() => {
        if (pendingCheckSeq.current === seq) {
          setWaitingForPendingWrites(true);
        }
      }, 120);
    }

    waitForPendingWrites(db)
      .then(() => {
        if (pendingCheckSeq.current === seq) {
          if (pendingGraceTimer.current) {
            clearTimeout(pendingGraceTimer.current);
            pendingGraceTimer.current = null;
          }
          setWaitingForPendingWrites(false);
        }
      })
      .catch(() => {
        if (pendingCheckSeq.current === seq) {
          if (pendingGraceTimer.current) {
            clearTimeout(pendingGraceTimer.current);
            pendingGraceTimer.current = null;
          }
          setWaitingForPendingWrites(false);
        }
      });
  }, []);

  const onFarmMetadata = useCallback(
    (meta: { fromCache: boolean; hasPendingWrites: boolean }) => {
      setFromCache(meta.fromCache);
      setHasPendingWrites(meta.hasPendingWrites);
      if (!meta.fromCache) {
        setServerUnreachable(false);
      }
      if (meta.hasPendingWrites) {
        checkPendingWrites(true);
      }
    },
    [checkPendingWrites]
  );

  useEffect(() => {
    return () => {
      if (pendingGraceTimer.current) {
        clearTimeout(pendingGraceTimer.current);
      }
    };
  }, []);

  // Subscribe to global tracker (queries, unreachable flag)
  useEffect(() => {
    return subscribeSyncTracker(() => {
      setTracker(getSyncTrackerState());
    });
  }, []);

  // Browser network online / offline listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      setServerUnreachable(false);
      checkPendingWrites(true);
      void testConnection();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkPendingWrites]);

  // Firestore snapshots-in-sync listener to catch pending writes across all collections
  useEffect(() => {
    if (!active) return;

    checkPendingWrites(false);

    const unsubInSync = onSnapshotsInSync(db, () => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        checkPendingWrites(false);
      }
    });

    return () => {
      unsubInSync();
    };
  }, [active, checkPendingWrites]);

  const syncState = resolveFirebaseSyncState({
    isOnline,
    fromCache: active ? fromCache : false,
    hasPendingWrites,
    activeOperations: tracker.activeOperations,
    waitingForPendingWrites,
    serverUnreachable: tracker.serverUnreachable,
  });

  return { syncState, onFarmMetadata };
}
