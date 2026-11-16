import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { signInWithPopup as authSignInWithPopup, signOut as authSignOut, type User } from 'firebase/auth';
import {
  DEFAULT_TIMEZONE,
  OWNER_FULL_PERMISSIONS,
  generateId,
  toEmailKey,
} from '../domain/calculations.ts';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { Farm, FarmMember, PendingInvite, UserFarmBinding } from '../types/farm.ts';

export async function signInWithGoogle(): Promise<User> {
  const cred = await authSignInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await authSignOut(auth);
}

export async function getUserBinding(uid: string): Promise<UserFarmBinding | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data() as UserFarmBinding;
    if (!data || !data.farmId) return null;
    return data;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function clearUserBinding(uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    await deleteDoc(doc(db, 'users', uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function getPendingInviteForEmail(email: string): Promise<PendingInvite | null> {
  if (!email) return null;
  const emailKey = toEmailKey(email);
  const path = `pendingInvites/${emailKey}`;
  try {
    const snap = await getDoc(doc(db, 'pendingInvites', emailKey));
    if (!snap.exists()) return null;
    const data = snap.data() as PendingInvite;
    return data.status === 'pending' ? data : null;
  } catch (err) {
    // Permission denied simply means no invite exists for this email or it belongs to someone else
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes('permission') || msg.includes('insufficient')) {
      return null;
    }
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function createFarmAndOwner(params: {
  user: User;
  farmName: string;
  location: string;
  contactPhone: string;
  contactEmail: string;
  timezone?: string;
}): Promise<string> {
  const { user } = params;
  if (!user.email || !user.emailVerified) {
    throw new Error('A verified email account is required to initialize a farm.');
  }
  const farmName = params.farmName.trim();
  if (farmName.length < 2) {
    throw new Error('Farm name must be at least 2 characters.');
  }

  const farmId = generateId('farm');
  const displayName = (user.displayName || user.email.split('@')[0] || 'Farm Owner').slice(0, 150);
  const timezone = (params.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

  const batch = writeBatch(db);
  const farmRef = doc(db, 'farms', farmId);
  const memberRef = doc(db, 'farms', farmId, 'members', user.uid);
  const userRef = doc(db, 'users', user.uid);

  batch.set(farmRef, {
    farmId,
    name: farmName.slice(0, 120),
    location: params.location.trim().slice(0, 200),
    contactPhone: params.contactPhone.trim().slice(0, 60),
    contactEmail: (params.contactEmail.trim() || user.email).slice(0, 150),
    currency: 'NGN',
    timezone: timezone.slice(0, 64),
    activeSectors: ['poultry'],
    ownerUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(memberRef, {
    uid: user.uid,
    farmId,
    email: user.email.toLowerCase().slice(0, 200),
    displayName,
    jobTitle: 'Farm Owner',
    role: 'owner',
    status: 'active',
    permissions: OWNER_FULL_PERMISSIONS,
    departments: ['poultry', 'fishery', 'crops', 'livestock', 'general'],
    assignedPenIds: [],
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(userRef, {
    uid: user.uid,
    email: user.email.toLowerCase().slice(0, 200),
    displayName,
    farmId,
    role: 'owner',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return farmId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `farms/${farmId}`);
  }
}

export async function acceptPendingInvite(params: {
  user: User;
  invite: PendingInvite;
}): Promise<string> {
  const { user, invite } = params;
  if (!user.email || !user.emailVerified) {
    throw new Error('A verified email account is required to accept an invitation.');
  }
  if (user.email.toLowerCase() !== invite.emailLower) {
    throw new Error('Signed-in email does not match the invitation email.');
  }

  const displayName = (user.displayName || user.email.split('@')[0] || 'Farm Staff').slice(0, 150);
  const batch = writeBatch(db);

  const pendingRef = doc(db, 'pendingInvites', invite.emailKey);
  const farmInviteRef = doc(db, 'farms', invite.farmId, 'invites', invite.inviteId);
  const memberRef = doc(db, 'farms', invite.farmId, 'members', user.uid);
  const userRef = doc(db, 'users', user.uid);

  batch.update(pendingRef, {
    status: 'accepted',
    acceptedByUid: user.uid,
    updatedAt: serverTimestamp(),
  });

  batch.update(farmInviteRef, {
    status: 'accepted',
    acceptedByUid: user.uid,
    updatedAt: serverTimestamp(),
  });

  batch.set(memberRef, {
    uid: user.uid,
    farmId: invite.farmId,
    email: user.email.toLowerCase().slice(0, 200),
    displayName,
    jobTitle: invite.jobTitle,
    role: 'staff',
    status: 'active',
    permissions: invite.permissions,
    departments: invite.departments || ['poultry'],
    assignedPenIds: invite.assignedPenIds || [],
    createdBy: invite.invitedBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(userRef, {
    uid: user.uid,
    email: user.email.toLowerCase().slice(0, 200),
    displayName,
    farmId: invite.farmId,
    role: 'staff',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return invite.farmId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `pendingInvites/${invite.emailKey}`);
  }
}

export function subscribeFarmProfile(
  farmId: string,
  onData: (farm: Farm | null) => void,
  onError: (err: Error) => void,
  onMetadata?: (meta: { fromCache: boolean; hasPendingWrites: boolean }) => void
) {
  const path = `farms/${farmId}`;
  return onSnapshot(
    doc(db, 'farms', farmId),
    { includeMetadataChanges: true },
    (snap) => {
      onMetadata?.({
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
      });
      onData(snap.exists() ? (snap.data() as Farm) : null);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeCurrentMember(
  farmId: string,
  uid: string,
  onData: (member: FarmMember | null) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/members/${uid}`;
  return onSnapshot(
    doc(db, 'farms', farmId, 'members', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as FarmMember) : null);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}
