const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('../tools/node_modules/@firebase/rules-unit-testing');
const {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} = require('../tools/node_modules/firebase/firestore');

const projectId = 'babagiwafarm';
const farmId = 'babagiwa_farm';
const email = 'invitee@example.com';
const emailKey = 'invitee_example_com';
const farmName = 'Babagiwa Farm';
const invitedBy = 'owner_123';
const permissions = {
  batches: { read: true, create: true, edit: true, delete: true },
  production: { read: true, create: true, edit: true, delete: true, approve: false },
  feed: { read: true, create: true, edit: true, delete: true },
  sales: { read: true, create: true, edit: true, delete: true, overridePrice: false },
  reports: { read: true, export: false },
  settings: { read: false, edit: false },
  members: { read: false, manage: false },
  eggStore: { read: false, transfer: false, receive: false, sort: false, adjust: false, distribute: false, dispose: false },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function seedInvite(env, { uid, targetEmail, key, inviteId }) {
  const pending = {
    emailKey: key,
    farmId,
    farmName,
    inviteId,
    emailLower: targetEmail,
    jobTitle: 'Farm Attendant',
    role: 'staff',
    permissions,
    departments: ['poultry'],
    assignedPenIds: [],
    status: 'pending',
    invitedBy,
    acceptedByUid: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const farmInvite = {
    id: inviteId,
    farmId,
    emailKey: key,
    emailLower: targetEmail,
    jobTitle: 'Farm Attendant',
    role: 'staff',
    permissions,
    departments: ['poultry'],
    assignedPenIds: [],
    status: 'pending',
    invitedBy,
    acceptedByUid: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, 'farms', farmId), { farmId, name: farmName, ownerUid: invitedBy });
    await setDoc(doc(adminDb, 'pendingInvites', key), pending);
    await setDoc(doc(adminDb, 'farms', farmId, 'invites', inviteId), farmInvite);
  });
  return { uid, targetEmail, key, inviteId };
}

async function verifyRead(db, label, ref) {
  try {
    await getDoc(ref);
    console.log(`PASS read: ${label}`);
  } catch (error) {
    console.error(`FAIL read: ${label}: ${error.code || ''} ${error.message}`);
    throw error;
  }
}

async function accept(env, fixture) {
  const { uid, targetEmail, key, inviteId } = fixture;
  const db = env.authenticatedContext(uid, { email: targetEmail, email_verified: true }).firestore();
  const pendingRef = doc(db, 'pendingInvites', key);
  const farmInviteRef = doc(db, 'farms', farmId, 'invites', inviteId);
  const memberRef = doc(db, 'farms', farmId, 'members', uid);
  const userDocId = `${farmId}_${uid}`;
  const userRef = doc(db, 'users', userDocId);
  const bindingRef = doc(db, 'userBindings', uid);

  await verifyRead(db, 'accept: pending invite', pendingRef);
  await verifyRead(db, 'accept: farm invite', farmInviteRef);
  await verifyRead(db, 'accept: own missing member record', memberRef);
  await verifyRead(db, 'accept: own missing user binding', bindingRef);

  await runTransaction(db, async (transaction) => {
    const [pendingSnapshot, farmInviteSnapshot, existingMember, existingBinding] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(farmInviteRef),
      transaction.get(memberRef),
      transaction.get(bindingRef),
    ]);
    assert(pendingSnapshot.exists() && farmInviteSnapshot.exists(), 'seeded invite docs should exist');
    assert(!existingMember.exists() && !existingBinding.exists(), 'fixture should be a first acceptance');
    const current = pendingSnapshot.data();
    transaction.update(pendingRef, { status: 'accepted', acceptedByUid: uid, updatedAt: serverTimestamp() });
    transaction.update(farmInviteRef, { status: 'accepted', acceptedByUid: uid, updatedAt: serverTimestamp() });
    transaction.set(memberRef, {
      uid, farmId, email: targetEmail, displayName: 'Test Invitee', jobTitle: current.jobTitle,
      role: current.role, status: 'active', permissions: current.permissions,
      departments: current.departments, assignedPenIds: current.assignedPenIds,
      createdBy: current.invitedBy, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    const userRecord = {
      uid, email: targetEmail, displayName: 'Test Invitee', farmId, role: current.role,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    transaction.set(userRef, userRecord);
    transaction.set(bindingRef, userRecord);
  });
  console.log('PASS transaction: accept invite');
}

async function decline(env, fixture) {
  const { uid, targetEmail, key, inviteId } = fixture;
  const db = env.authenticatedContext(uid, { email: targetEmail, email_verified: true }).firestore();
  const pendingRef = doc(db, 'pendingInvites', key);
  const farmInviteRef = doc(db, 'farms', farmId, 'invites', inviteId);
  await verifyRead(db, 'decline: pending invite', pendingRef);
  await verifyRead(db, 'decline: farm invite', farmInviteRef);

  await runTransaction(db, async (transaction) => {
    const [pendingSnapshot, farmInviteSnapshot] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(farmInviteRef),
    ]);
    assert(pendingSnapshot.exists() && farmInviteSnapshot.exists(), 'seeded invite docs should exist');
    transaction.update(pendingRef, {
      status: 'rejected', rejectedByUid: uid, rejectionReason: 'Test decline', updatedAt: serverTimestamp(),
    });
    transaction.update(farmInviteRef, {
      status: 'rejected', rejectedByUid: uid, rejectionReason: 'Test decline', updatedAt: serverTimestamp(),
    });
  });
  console.log('PASS transaction: decline invite');
}

(async () => {
  const rules = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');
  const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    const acceptFixture = await seedInvite(env, {
      uid: 'invitee_123', targetEmail: email, key: emailKey, inviteId: 'invite_accept_123',
    });
    await accept(env, acceptFixture);

    const declineFixture = await seedInvite(env, {
      uid: 'decliner_123', targetEmail: 'decliner@example.com', key: 'decliner_example_com', inviteId: 'invite_decline_123',
    });
    await decline(env, declineFixture);
    console.log('ALL INVITE RULE TESTS PASSED');
  } finally {
    await env.cleanup();
  }
})().catch((error) => {
  console.error('INVITE RULE TEST FAILED:', error.code || '', error.stack || error.message || error);
  process.exitCode = 1;
});
