import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { generateId } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type {
  CarePlan,
  CarePlanItem,
  RecurrenceUnit,
  ReminderType,
} from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

type Unsubscribe = () => void;

const VALID_PLAN_TYPES: readonly string[] = ['medication', 'vaccination', 'activity'];
const VALID_INTERVAL_UNITS: readonly RecurrenceUnit[] = ['once', 'hour', 'day', 'week', 'month'];

export async function createCarePlan(params: {
  farmId: string;
  name: string;
  description: string;
  planType: 'medication' | 'vaccination' | 'activity';
  actorUid: string;
  actorName: string;
}): Promise<string> {
  const name = params.name.trim().slice(0, 100);
  if (!name) throw new Error('Care plan name is required.');
  if (!VALID_PLAN_TYPES.includes(params.planType)) {
    throw new Error('Invalid plan type. Must be medication, vaccination, or activity.');
  }
  const description = params.description.trim().slice(0, 300);

  const id = generateId('cplan');
  const batchWrite = writeBatch(db);

  batchWrite.set(doc(db, 'farms', params.farmId, 'carePlans', id), {
    id,
    farmId: params.farmId,
    name,
    description,
    planType: params.planType,
    status: 'active',
    createdBy: params.actorUid,
    createdByName: params.actorName.slice(0, 150),
    updatedBy: params.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'carePlan',
    entityId: id,
    action: 'create',
    summary: `Created care plan "${name}" (${params.planType})`,
    after: { name, planType: params.planType, status: 'active' },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/carePlans/${id}`);
  }
}

export async function updateCarePlan(params: {
  farmId: string;
  plan: CarePlan;
  name: string;
  description: string;
  planType: 'medication' | 'vaccination' | 'activity';
  status: 'active' | 'inactive';
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const name = params.name.trim().slice(0, 100);
  if (!name) throw new Error('Care plan name is required.');
  if (!VALID_PLAN_TYPES.includes(params.planType)) {
    throw new Error('Invalid plan type. Must be medication, vaccination, or activity.');
  }
  const description = params.description.trim().slice(0, 300);

  const batchWrite = writeBatch(db);
  const updates = {
    name,
    description,
    planType: params.planType,
    status: params.status,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };
  batchWrite.update(doc(db, 'farms', params.farmId, 'carePlans', params.plan.id), updates);

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'carePlan',
    entityId: params.plan.id,
    action: 'update',
    summary: `Updated care plan "${name}"`,
    before: { name: params.plan.name, planType: params.plan.planType, status: params.plan.status },
    after: updates,
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/carePlans/${params.plan.id}`);
  }
}

export async function createCarePlanItem(params: {
  farmId: string;
  carePlanId: string;
  title: string;
  reminderType: ReminderType;
  dosageOrAction: string;
  notes: string;
  offsetDays: number;
  intervalUnit: RecurrenceUnit;
  intervalValue: number;
  sortOrder: number;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  const title = params.title.trim().slice(0, 140);
  if (!title) throw new Error('Care plan item title is required.');
  if (!VALID_INTERVAL_UNITS.includes(params.intervalUnit)) {
    throw new Error('Invalid interval unit.');
  }
  if (!Number.isInteger(params.offsetDays) || params.offsetDays < 0) {
    throw new Error('Offset days must be a non-negative integer.');
  }
  if (params.intervalUnit !== 'once' && (!Number.isInteger(params.intervalValue) || params.intervalValue < 1)) {
    throw new Error('Interval value must be at least 1.');
  }

  const dosageOrAction = params.dosageOrAction.trim().slice(0, 140);
  const notes = params.notes.trim().slice(0, 500);
  const intervalValue = params.intervalUnit === 'once' ? 1 : Math.max(1, params.intervalValue);

  const id = generateId('citem');
  const batchWrite = writeBatch(db);

  batchWrite.set(
    doc(db, 'farms', params.farmId, 'carePlans', params.carePlanId, 'items', id),
    {
      id,
      carePlanId: params.carePlanId,
      farmId: params.farmId,
      title,
      reminderType: params.reminderType,
      dosageOrAction,
      notes,
      offsetDays: params.offsetDays,
      intervalUnit: params.intervalUnit,
      intervalValue,
      sortOrder: params.sortOrder,
      createdBy: params.actorUid,
      createdByName: params.actorName.slice(0, 150),
      updatedBy: params.actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
  );

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'carePlanItem',
    entityId: id,
    action: 'create',
    summary: `Added item "${title}" to care plan ${params.carePlanId}`,
    after: { title, reminderType: params.reminderType, offsetDays: params.offsetDays },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
    return id;
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `farms/${params.farmId}/carePlans/${params.carePlanId}/items/${id}`
    );
  }
}

export async function updateCarePlanItem(params: {
  farmId: string;
  item: CarePlanItem;
  title: string;
  reminderType: ReminderType;
  dosageOrAction: string;
  notes: string;
  offsetDays: number;
  intervalUnit: RecurrenceUnit;
  intervalValue: number;
  sortOrder: number;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const title = params.title.trim().slice(0, 140);
  if (!title) throw new Error('Care plan item title is required.');
  if (!VALID_INTERVAL_UNITS.includes(params.intervalUnit)) {
    throw new Error('Invalid interval unit.');
  }
  if (!Number.isInteger(params.offsetDays) || params.offsetDays < 0) {
    throw new Error('Offset days must be a non-negative integer.');
  }
  if (params.intervalUnit !== 'once' && (!Number.isInteger(params.intervalValue) || params.intervalValue < 1)) {
    throw new Error('Interval value must be at least 1.');
  }

  const dosageOrAction = params.dosageOrAction.trim().slice(0, 140);
  const notes = params.notes.trim().slice(0, 500);
  const intervalValue = params.intervalUnit === 'once' ? 1 : Math.max(1, params.intervalValue);

  const batchWrite = writeBatch(db);
  const updates = {
    title,
    reminderType: params.reminderType,
    dosageOrAction,
    notes,
    offsetDays: params.offsetDays,
    intervalUnit: params.intervalUnit,
    intervalValue,
    sortOrder: params.sortOrder,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };

  batchWrite.update(
    doc(db, 'farms', params.farmId, 'carePlans', params.item.carePlanId, 'items', params.item.id),
    updates
  );

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'carePlanItem',
    entityId: params.item.id,
    action: 'update',
    summary: `Updated item "${title}" in care plan ${params.item.carePlanId}`,
    before: { title: params.item.title, reminderType: params.item.reminderType },
    after: { title, reminderType: params.reminderType },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `farms/${params.farmId}/carePlans/${params.item.carePlanId}/items/${params.item.id}`
    );
  }
}

export async function deleteCarePlanItem(params: {
  farmId: string;
  item: CarePlanItem;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const batchWrite = writeBatch(db);

  batchWrite.delete(
    doc(db, 'farms', params.farmId, 'carePlans', params.item.carePlanId, 'items', params.item.id)
  );

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'carePlanItem',
    entityId: params.item.id,
    action: 'delete',
    summary: `Deleted item "${params.item.title}" from care plan ${params.item.carePlanId}`,
    before: { title: params.item.title, reminderType: params.item.reminderType },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `farms/${params.farmId}/carePlans/${params.item.carePlanId}/items/${params.item.id}`
    );
  }
}

export function subscribeCarePlans(
  farmId: string,
  onData: (plans: CarePlan[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `farms/${farmId}/carePlans`;
  const q = query(collection(db, 'farms', farmId, 'carePlans'), orderBy('name', 'asc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as CarePlan)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export function subscribeCarePlanItems(
  farmId: string,
  carePlanId: string,
  onData: (items: CarePlanItem[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `farms/${farmId}/carePlans/${carePlanId}/items`;
  const q = query(
    collection(db, 'farms', farmId, 'carePlans', carePlanId, 'items'),
    orderBy('sortOrder', 'asc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as CarePlanItem)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function deleteCarePlan(params: {
  farmId: string;
  plan: CarePlan;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const activeBatches = await getDocs(query(
    collection(db, 'farms', params.farmId, 'batches'),
    where('status', '==', 'active'),
    where('assignedCarePlanIds', 'array-contains', params.plan.id)
  ));
  if (!activeBatches.empty) {
    throw new Error('This care plan is assigned to an active batch. Remove it from the batch before deleting the plan.');
  }
  const items = await getDocs(collection(db, 'farms', params.farmId, 'carePlans', params.plan.id, 'items'));
  if (items.size > 498) {
    throw new Error('This care plan has too many items to delete atomically. Remove some items first, then retry.');
  }
  const batchWrite = writeBatch(db);
  items.docs.forEach((item) => batchWrite.delete(item.ref));
  batchWrite.delete(doc(db, 'farms', params.farmId, 'carePlans', params.plan.id));

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'carePlan',
    entityId: params.plan.id,
    action: 'delete',
    summary: `Deleted care plan "${params.plan.name}"`,
    before: { name: params.plan.name, planType: params.plan.planType },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `farms/${params.farmId}/carePlans/${params.plan.id}`);
  }
}

export async function getCarePlanItemsForPlans(
  farmId: string,
  carePlanIds: string[]
): Promise<CarePlanItem[]> {
  if (carePlanIds.length === 0) return [];
  const results: CarePlanItem[] = [];
  for (const planId of carePlanIds) {
    const q = query(
      collection(db, 'farms', farmId, 'carePlans', planId, 'items'),
      orderBy('sortOrder', 'asc')
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => results.push(d.data() as CarePlanItem));
  }
  return results;
}
