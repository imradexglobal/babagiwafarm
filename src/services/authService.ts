import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { signInWithPopup as authSignInWithPopup, signOut as authSignOut, type User } from 'firebase/auth';
import {
  DEFAULT_TIMEZONE,
  OWNER_FULL_PERMISSIONS,
  toEmailKey,
} from '../domain/calculations.ts';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { Farm, FarmMember, PendingInvite, UserFarmBinding } from '../types/farm.ts';

export function normalizeFarmId(name: string): string {
  // Firestore farm document IDs are intentionally human-readable and stable:
  // "Babagiwa Farm" -> "babagiwa_farm". Do not add a generated prefix.
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildUserDocumentId(farmId: string, displayName: string): string {
  const farmKey = normalizeFarmId(farmId);
  const nameKey = normalizeFarmId(displayName) || 'user';
  return `${farmKey}_${nameKey}`;
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await authSignInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await authSignOut(auth);
}

export async function getUserBinding(uid: string): Promise<UserFarmBinding | null> {
  const path = `userBindings/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'userBindings', uid));
    if (snap.exists()) return snap.data() as UserFarmBinding;

    // Backward-compatible read for accounts created before the name-based ID migration.
    const legacySnap = await getDoc(doc(db, 'users', uid));
    if (!legacySnap.exists()) return null;
    const data = legacySnap.data() as UserFarmBinding;
    if (!data || !data.farmId) return null;
    return data;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function clearUserBinding(uid: string): Promise<void> {
  const path = `userBindings/${uid}`;
  try {
    const binding = await getUserBinding(uid);
    await deleteDoc(doc(db, 'userBindings', uid));
    if (binding) {
      await deleteDoc(doc(db, 'users', buildUserDocumentId(binding.farmId, binding.displayName)));
    }
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
  const userEmail = user.email.toLowerCase();
  const farmName = params.farmName.trim();
  if (farmName.length < 2) {
    throw new Error('Farm name must be at least 2 characters.');
  }

  const farmId = normalizeFarmId(farmName);
  if (!farmId) {
    throw new Error('Farm name must contain at least one letter or number.');
  }
  const displayName = (user.displayName || userEmail.split('@')[0] || 'Farm Owner').slice(0, 150);
  const timezone = (params.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

  const farmRef = doc(db, 'farms', farmId);
  const memberRef = doc(db, 'farms', farmId, 'members', user.uid);
  const userDocId = buildUserDocumentId(farmId, displayName);
  const userRef = doc(db, 'users', userDocId);
  const bindingRef = doc(db, 'userBindings', user.uid);

  try {
    const batch = writeBatch(db);
    batch.set(farmRef, {
        farmId,
        name: farmName.slice(0, 120),
        location: params.location.trim().slice(0, 200),
        contactPhone: params.contactPhone.trim().slice(0, 60),
        contactEmail: (params.contactEmail.trim() || userEmail).slice(0, 150),
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
        email: userEmail.slice(0, 200),
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
        email: userEmail.slice(0, 200),
        displayName,
        farmId,
        role: 'owner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    batch.set(bindingRef, {
        uid: user.uid,
        email: userEmail.slice(0, 200),
        displayName,
        farmId,
        role: 'owner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
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

  const userEmail = user.email.toLowerCase();
  const displayName = (user.displayName || userEmail.split('@')[0] || 'Farm Staff').slice(0, 150);
  const pendingRef = doc(db, 'pendingInvites', invite.emailKey);
  const farmInviteRef = doc(db, 'farms', invite.farmId, 'invites', invite.inviteId);
  const memberRef = doc(db, 'farms', invite.farmId, 'members', user.uid);
  const userDocId = buildUserDocumentId(invite.farmId, displayName);
  const userRef = doc(db, 'users', userDocId);
  const bindingRef = doc(db, 'userBindings', user.uid);

  try {
    await runTransaction(db, async (transaction) => {
      const [pendingSnapshot, farmInviteSnapshot, existingMember, existingUser, existingBinding] = await Promise.all([
        transaction.get(pendingRef),
        transaction.get(farmInviteRef),
        transaction.get(memberRef),
        transaction.get(userRef),
        transaction.get(bindingRef),
      ]);
      if (!pendingSnapshot.exists() || !farmInviteSnapshot.exists()) {
        throw new Error('This invitation is invalid or may have expired.');
      }
      const current = pendingSnapshot.data() as PendingInvite;
      if (current.emailLower !== userEmail) {
        throw new Error('Signed-in email does not match the invitation email.');
      }
      if (current.status === 'accepted') {
        if (current.acceptedByUid === user.uid && existingMember.exists() && existingUser.exists() && existingBinding.exists()) return;
        throw new Error('This invitation has already been accepted.');
      }
      if (current.status !== 'pending') throw new Error('This invitation is invalid or may have expired.');
      const role = current.role || 'staff';
      const permissions = role === 'owner' ? OWNER_FULL_PERMISSIONS : current.permissions;
      transaction.update(pendingRef, { status: 'accepted', acceptedByUid: user.uid, updatedAt: serverTimestamp() });
      transaction.update(farmInviteRef, { status: 'accepted', acceptedByUid: user.uid, updatedAt: serverTimestamp() });
      transaction.set(memberRef, {
        uid: user.uid, farmId: current.farmId, email: userEmail.slice(0, 200), displayName,
        jobTitle: current.jobTitle, role, status: 'active', permissions,
        departments: role === 'owner' ? ['poultry', 'fishery', 'crops', 'livestock', 'general'] : (current.departments || ['poultry']),
        assignedPenIds: role === 'owner' ? [] : (current.assignedPenIds || []),
        createdBy: current.invitedBy, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      transaction.set(userRef, {
        uid: user.uid, email: userEmail.slice(0, 200), displayName,
        farmId: current.farmId, role, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      transaction.set(bindingRef, {
        uid: user.uid, email: userEmail.slice(0, 200), displayName,
        farmId: current.farmId, role, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
    return invite.farmId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `pendingInvites/${invite.emailKey}`);
  }
}

export async function rejectPendingInvite(params: {
  user: User;
  invite: PendingInvite;
  reason?: string;
}): Promise<void> {
  const { user, invite } = params;
  if (!user.email || !user.emailVerified) {
    throw new Error('A verified email account is required to respond to an invitation.');
  }
  if (user.email.toLowerCase() !== invite.emailLower) {
    throw new Error('Signed-in email does not match the invitation email.');
  }

  const reason = (params.reason || 'The invitee declined this invitation.').trim().slice(0, 300);
  const pendingRef = doc(db, 'pendingInvites', invite.emailKey);
  const farmInviteRef = doc(db, 'farms', invite.farmId, 'invites', invite.inviteId);

  try {
    await runTransaction(db, async (transaction) => {
      const [pendingSnapshot, farmInviteSnapshot] = await Promise.all([
        transaction.get(pendingRef),
        transaction.get(farmInviteRef),
      ]);
      if (!pendingSnapshot.exists() || !farmInviteSnapshot.exists()) {
        throw new Error('This invitation is invalid or may have expired.');
      }
      const current = pendingSnapshot.data() as PendingInvite;
      if (current.emailLower !== user.email!.toLowerCase()) {
        throw new Error('Signed-in email does not match the invitation email.');
      }
      if (current.status !== 'pending') {
        throw new Error('This invitation is no longer available.');
      }

      transaction.update(pendingRef, {
        status: 'rejected',
        rejectedByUid: user.uid,
        rejectionReason: reason,
        updatedAt: serverTimestamp(),
      });
      transaction.update(farmInviteRef, {
        status: 'rejected',
        rejectedByUid: user.uid,
        rejectionReason: reason,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && /invitation|email does not match/i.test(err.message)) throw err;
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
