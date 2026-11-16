import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { DEFAULT_BAG_WEIGHT_KG, generateId, toEmailKey } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type {
  AuditLog,
  DepartmentType,
  FarmInvite,
  FarmMember,
  FeedItem,
  FeedStock,
  Pen,
  PermissionsMatrix,
  SalesUnit,
} from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

export async function updateFarmProfile(params: {
  farmId: string;
  name: string;
  location: string;
  contactPhone: string;
  contactEmail: string;
  currency: string;
  timezone: string;
  actorUid: string;
  actorName: string;
  before: Record<string, unknown>;
}): Promise<void> {
  const name = params.name.trim();
  if (name.length < 2) throw new Error('Farm name must be at least 2 characters.');
  const batch = writeBatch(db);
  const farmRef = doc(db, 'farms', params.farmId);
  const updates = {
    name: name.slice(0, 120),
    location: params.location.trim().slice(0, 200),
    contactPhone: params.contactPhone.trim().slice(0, 60),
    contactEmail: params.contactEmail.trim().slice(0, 150),
    currency: (params.currency.trim() || 'NGN').slice(0, 10),
    timezone: (params.timezone.trim() || 'Africa/Lagos').slice(0, 64),
    updatedAt: serverTimestamp(),
  };
  batch.update(farmRef, updates);
  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'farm',
    entityId: params.farmId,
    action: 'update',
    summary: `Updated farm profile settings for ${updates.name}`,
    before: params.before,
    after: updates,
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}`);
  }
}

export async function createPen(params: {
  farmId: string;
  name: string;
  code: string;
  capacity: number;
  notes: string;
  department?: DepartmentType;
  assignedMemberUids?: string[];
  actorUid: string;
  actorName: string;
}): Promise<string> {
  const name = params.name.trim();
  const code = params.code.trim();
  if (!name) throw new Error('Pen name is required.');
  if (!code) throw new Error('Pen code is required.');
  if (!Number.isInteger(params.capacity) || params.capacity < 0) {
    throw new Error('Pen capacity must be a non-negative whole number.');
  }

  const id = generateId('pen');
  const penRef = doc(db, 'farms', params.farmId, 'pens', id);
  const batch = writeBatch(db);
  const payload = {
    id,
    farmId: params.farmId,
    name: name.slice(0, 80),
    code: code.slice(0, 30),
    capacity: params.capacity,
    sector: 'poultry' as const,
    department: params.department || 'poultry',
    assignedMemberUids: params.assignedMemberUids || [],
    activeBatchId: '',
    notes: params.notes.trim().slice(0, 300),
    status: 'active' as const,
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(penRef, payload);
  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'pen',
    entityId: id,
    action: 'create',
    summary: `Created pen ${payload.name} (${payload.code})`,
    after: { name: payload.name, code: payload.code, capacity: payload.capacity },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);
  try {
    await batch.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/pens/${id}`);
  }
}

export async function updatePen(params: {
  farmId: string;
  pen: Pen;
  name: string;
  code: string;
  capacity: number;
  notes: string;
  status: 'active' | 'inactive';
  department?: DepartmentType;
  assignedMemberUids?: string[];
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.status === 'inactive' && params.pen.activeBatchId) {
    throw new Error('Cannot deactivate a pen while an active batch is housed in it.');
  }
  const name = params.name.trim();
  const code = params.code.trim();
  if (!name || !code) throw new Error('Pen name and code are required.');
  if (!Number.isInteger(params.capacity) || params.capacity < 0) {
    throw new Error('Capacity must be a non-negative whole number.');
  }

  const batch = writeBatch(db);
  const penRef = doc(db, 'farms', params.farmId, 'pens', params.pen.id);
  const updates = {
    name: name.slice(0, 80),
    code: code.slice(0, 30),
    capacity: params.capacity,
    notes: params.notes.trim().slice(0, 300),
    status: params.status,
    department: params.department || params.pen.department || 'poultry',
    assignedMemberUids: params.assignedMemberUids !== undefined ? params.assignedMemberUids : (params.pen.assignedMemberUids || []),
    updatedAt: serverTimestamp(),
  };
  batch.update(penRef, updates);
  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'pen',
    entityId: params.pen.id,
    action: 'update',
    summary: `Updated pen ${updates.name} (${updates.code})`,
    before: { name: params.pen.name, code: params.pen.code, capacity: params.pen.capacity, status: params.pen.status },
    after: updates,
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/pens/${params.pen.id}`);
  }
}

export async function createFeedItem(params: {
  farmId: string;
  feedType: string;
  brand: string;
  defaultBagWeightKg: number;
  notes: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  const feedType = params.feedType.trim();
  const brand = params.brand.trim();
  const bagWeight = Number(params.defaultBagWeightKg) || DEFAULT_BAG_WEIGHT_KG;
  if (!feedType || !brand) throw new Error('Feed type and brand are required.');
  if (!Number.isFinite(bagWeight) || bagWeight <= 0 || bagWeight > 1000) {
    throw new Error('Default bag weight must be between 0.1 and 1000 kg.');
  }

  const id = generateId('feed');
  const itemRef = doc(db, 'farms', params.farmId, 'feedItems', id);
  const stockRef = doc(db, 'farms', params.farmId, 'feedStock', id);

  try {
    const batch = writeBatch(db);
    batch.set(itemRef, {
      id,
      farmId: params.farmId,
      feedType: feedType.slice(0, 80),
      brand: brand.slice(0, 80),
      defaultBagWeightKg: bagWeight,
      notes: params.notes.trim().slice(0, 300),
      status: 'active',
      createdBy: params.actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(stockRef, {
      feedItemId: id,
      farmId: params.farmId,
      feedType: feedType.slice(0, 80),
      brand: brand.slice(0, 80),
      balanceGrams: 0,
      lastPurchaseDate: '',
      lastUnitCostPerGramNgn: 0,
      updatedAt: serverTimestamp(),
    });
    const audit = buildAuditLogEntry({
      farmId: params.farmId,
      entityType: 'feedItem',
      entityId: id,
      action: 'create',
      summary: `Added feed item ${feedType} (${brand}, ${bagWeight} kg bag)`,
      after: { feedType, brand, defaultBagWeightKg: bagWeight },
      actorUid: params.actorUid,
      actorName: params.actorName,
    });
    batch.set(audit.ref, audit.data);
    await batch.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/feedItems/${id}`);
  }
}

export async function updateFeedItem(params: {
  farmId: string;
  item: FeedItem;
  feedType: string;
  brand: string;
  defaultBagWeightKg: number;
  notes: string;
  status: 'active' | 'inactive';
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const feedType = params.feedType.trim();
  const brand = params.brand.trim();
  if (!feedType || !brand) throw new Error('Feed type and brand are required.');
  if (!Number.isFinite(params.defaultBagWeightKg) || params.defaultBagWeightKg <= 0 || params.defaultBagWeightKg > 1000) {
    throw new Error('Default bag weight must be between 0.1 and 1000 kg.');
  }
  const batch = writeBatch(db);
  const itemRef = doc(db, 'farms', params.farmId, 'feedItems', params.item.id);
  const updates = {
    feedType: feedType.slice(0, 80),
    brand: brand.slice(0, 80),
    defaultBagWeightKg: params.defaultBagWeightKg,
    notes: params.notes.trim().slice(0, 300),
    status: params.status,
    updatedAt: serverTimestamp(),
  };
  batch.update(itemRef, updates);
  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'feedItem',
    entityId: params.item.id,
    action: 'update',
    summary: `Updated feed item ${feedType} (${brand})`,
    before: {
      feedType: params.item.feedType,
      brand: params.item.brand,
      defaultBagWeightKg: params.item.defaultBagWeightKg,
      status: params.item.status,
    },
    after: updates,
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/feedItems/${params.item.id}`);
  }
}

export async function createSalesUnit(params: {
  farmId: string;
  name: string;
  eggCountPerUnit: number;
  currentPriceNgn: number;
  effectiveDate: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  const name = params.name.trim();
  if (!name) throw new Error('Selling unit name is required.');
  if (!Number.isInteger(params.eggCountPerUnit) || params.eggCountPerUnit < 1) {
    throw new Error('Eggs per unit must be a whole number >= 1.');
  }
  if (!Number.isFinite(params.currentPriceNgn) || params.currentPriceNgn < 0) {
    throw new Error('Current price (NGN) must be zero or positive.');
  }

  const id = generateId('unit');
  const batch = writeBatch(db);
  batch.set(doc(db, 'farms', params.farmId, 'salesUnits', id), {
    id,
    farmId: params.farmId,
    name: name.slice(0, 80),
    eggCountPerUnit: params.eggCountPerUnit,
    currentPriceNgn: Math.round(params.currentPriceNgn * 100) / 100,
    effectiveDate: params.effectiveDate,
    status: 'active',
    createdBy: params.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'salesUnit',
    entityId: id,
    action: 'create',
    summary: `Created egg sales unit "${name}" (${params.eggCountPerUnit} eggs) at ₦${params.currentPriceNgn}`,
    after: { name, eggCountPerUnit: params.eggCountPerUnit, currentPriceNgn: params.currentPriceNgn, effectiveDate: params.effectiveDate },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);
  try {
    await batch.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/salesUnits/${id}`);
  }
}

export async function updateSalesUnit(params: {
  farmId: string;
  unit: SalesUnit;
  name: string;
  eggCountPerUnit: number;
  currentPriceNgn: number;
  effectiveDate: string;
  status: 'active' | 'inactive';
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const name = params.name.trim();
  if (!name) throw new Error('Selling unit name is required.');
  if (!Number.isInteger(params.eggCountPerUnit) || params.eggCountPerUnit < 1) {
    throw new Error('Eggs per unit must be a whole number >= 1.');
  }
  if (!Number.isFinite(params.currentPriceNgn) || params.currentPriceNgn < 0) {
    throw new Error('Unit price must be zero or positive.');
  }
  const batch = writeBatch(db);
  const updates = {
    name: name.slice(0, 80),
    eggCountPerUnit: params.eggCountPerUnit,
    currentPriceNgn: Math.round(params.currentPriceNgn * 100) / 100,
    effectiveDate: params.effectiveDate,
    status: params.status,
    updatedAt: serverTimestamp(),
  };
  batch.update(doc(db, 'farms', params.farmId, 'salesUnits', params.unit.id), updates);
  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'salesUnit',
    entityId: params.unit.id,
    action: 'update',
    summary: `Updated sales unit "${name}" price/config (future sales only)`,
    before: {
      name: params.unit.name,
      eggCountPerUnit: params.unit.eggCountPerUnit,
      currentPriceNgn: params.unit.currentPriceNgn,
      effectiveDate: params.unit.effectiveDate,
      status: params.unit.status,
    },
    after: updates,
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/salesUnits/${params.unit.id}`);
  }
}

export async function createStaffInvite(params: {
  farmId: string;
  farmName: string;
  email: string;
  jobTitle: string;
  permissions: PermissionsMatrix;
  departments?: DepartmentType[];
  assignedPenIds?: string[];
  actorUid: string;
  actorName: string;
}): Promise<string> {
  const emailLower = params.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    throw new Error('Please enter a valid staff email address.');
  }
  const jobTitle = params.jobTitle.trim();
  if (!jobTitle) throw new Error('Descriptive job title is required.');

  const emailKey = toEmailKey(emailLower);
  const inviteId = generateId('inv');
  const batch = writeBatch(db);
  const departments = params.departments && params.departments.length > 0 ? params.departments : ['poultry' as DepartmentType];
  const assignedPenIds = params.assignedPenIds || [];

  batch.set(doc(db, 'pendingInvites', emailKey), {
    emailKey,
    farmId: params.farmId,
    farmName: params.farmName.slice(0, 120),
    inviteId,
    emailLower: emailLower.slice(0, 200),
    jobTitle: jobTitle.slice(0, 80),
    role: 'staff',
    permissions: params.permissions,
    departments,
    assignedPenIds,
    status: 'pending',
    invitedBy: params.actorUid,
    acceptedByUid: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'farms', params.farmId, 'invites', inviteId), {
    id: inviteId,
    farmId: params.farmId,
    emailKey,
    emailLower: emailLower.slice(0, 200),
    jobTitle: jobTitle.slice(0, 80),
    permissions: params.permissions,
    departments,
    assignedPenIds,
    status: 'pending',
    invitedBy: params.actorUid,
    acceptedByUid: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'invite',
    entityId: inviteId,
    action: 'create',
    summary: `Invited ${emailLower} as ${jobTitle}`,
    after: { emailLower, jobTitle },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);

  try {
    await batch.commit();
    return inviteId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/invites/${inviteId}`);
  }
}

export async function revokeStaffInvite(params: {
  farmId: string;
  invite: FarmInvite;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'farms', params.farmId, 'invites', params.invite.id), {
    status: 'revoked',
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'pendingInvites', params.invite.emailKey), {
    status: 'revoked',
    updatedAt: serverTimestamp(),
  });
  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'invite',
    entityId: params.invite.id,
    action: 'status_change',
    summary: `Revoked invitation for ${params.invite.emailLower}`,
    before: { status: params.invite.status },
    after: { status: 'revoked' },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/invites/${params.invite.id}`);
  }
}

export async function updateStaffMember(params: {
  farmId: string;
  target: FarmMember;
  jobTitle: string;
  status: 'active' | 'inactive';
  permissions: PermissionsMatrix;
  departments?: DepartmentType[];
  assignedPenIds?: string[];
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.target.role === 'owner') {
    throw new Error('Owner role and permissions cannot be modified.');
  }
  if (params.target.uid === params.actorUid) {
    throw new Error('You cannot modify your own permissions or status.');
  }

  const batch = writeBatch(db);
  const memberRef = doc(db, 'farms', params.farmId, 'members', params.target.uid);
  const updates: Record<string, unknown> = {
    jobTitle: params.jobTitle.trim().slice(0, 80) || params.target.jobTitle,
    status: params.status,
    permissions: params.permissions,
    updatedAt: serverTimestamp(),
  };
  if (params.departments !== undefined) {
    updates.departments = params.departments;
  }
  if (params.assignedPenIds !== undefined) {
    updates.assignedPenIds = params.assignedPenIds;
  }
  batch.update(memberRef, updates);
  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'member',
    entityId: params.target.uid,
    action: 'permission_change',
    summary: `Updated access/status for ${params.target.displayName} (${updates.status})`,
    before: {
      jobTitle: params.target.jobTitle,
      status: params.target.status,
      permissions: params.target.permissions,
    },
    after: updates,
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batch.set(audit.ref, audit.data);
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/members/${params.target.uid}`);
  }
}

export function subscribePens(
  farmId: string,
  onData: (pens: Pen[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/pens`;
  const q = query(collection(db, 'farms', farmId, 'pens'), orderBy('name', 'asc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as Pen)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export function subscribeFeedItems(
  farmId: string,
  onData: (items: FeedItem[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/feedItems`;
  const q = query(collection(db, 'farms', farmId, 'feedItems'), orderBy('feedType', 'asc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FeedItem)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export function subscribeFeedStock(
  farmId: string,
  onData: (stocks: FeedStock[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/feedStock`;
  return onSnapshot(
    collection(db, 'farms', farmId, 'feedStock'),
    (snap) => onData(snap.docs.map((d) => d.data() as FeedStock)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export function subscribeSalesUnits(
  farmId: string,
  onData: (units: SalesUnit[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/salesUnits`;
  const q = query(collection(db, 'farms', farmId, 'salesUnits'), orderBy('eggCountPerUnit', 'desc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as SalesUnit)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export function subscribeMembers(
  farmId: string,
  onData: (members: FarmMember[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/members`;
  return onSnapshot(
    collection(db, 'farms', farmId, 'members'),
    (snap) => onData(snap.docs.map((d) => d.data() as FarmMember)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export function subscribeInvites(
  farmId: string,
  onData: (invites: FarmInvite[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/invites`;
  const q = query(collection(db, 'farms', farmId, 'invites'), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FarmInvite)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export function subscribeAuditLogs(
  farmId: string,
  onData: (logs: AuditLog[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/auditLogs`;
  const q = query(collection(db, 'farms', farmId, 'auditLogs'), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as AuditLog)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}
