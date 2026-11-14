import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  calculateBirdAgeDays,
  formatDateInTimezone,
  generateId,
} from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type {
  FarmReminder,
  PoultryBatch,
  ReminderStatus,
  ReminderType,
} from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

const VALID_REMINDER_TYPES: readonly ReminderType[] = [
  'vaccination',
  'medication',
  'milestone',
];

const VALID_REMINDER_STATUSES: readonly ReminderStatus[] = [
  'pending',
  'completed',
  'dismissed',
];

export const REMINDER_TYPE_OPTIONS: { value: ReminderType; label: string }[] = [
  { value: 'vaccination', label: 'Vaccination' },
  { value: 'medication', label: 'Medication / Deworming' },
  { value: 'milestone', label: 'Age Milestone / Check' },
];

function computeOptionalTargetAgeDays(
  batch: PoultryBatch,
  dueDate: string,
  explicitAgeDays?: number | null
): number | null {
  if (typeof explicitAgeDays === 'number' && Number.isInteger(explicitAgeDays) && explicitAgeDays >= 0) {
    return Math.min(2000, explicitAgeDays);
  }
  if (explicitAgeDays === null) return null;
  try {
    if (dueDate >= batch.placementDate) {
      const days = calculateBirdAgeDays({
        hatchDate: batch.hatchDate,
        placementDate: batch.placementDate,
        ageAtPlacementDays: batch.ageAtPlacementDays,
        transactionDate: dueDate,
      });
      return days >= 0 && days <= 2000 ? days : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createFarmReminder(params: {
  farmId: string;
  batch: PoultryBatch;
  reminderType: ReminderType;
  title: string;
  dueDate: string;
  milestoneKey?: string;
  targetAgeDays?: number | null;
  dosageOrAction: string;
  notes: string;
  initialStatus?: ReminderStatus;
  completedAtDate?: string;
  timeZone?: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (!VALID_REMINDER_TYPES.includes(params.reminderType)) {
    throw new Error('Invalid reminder type.');
  }
  const initialStatus: ReminderStatus = params.initialStatus || 'pending';
  if (!VALID_REMINDER_STATUSES.includes(initialStatus)) {
    throw new Error('Invalid reminder status.');
  }
  if (initialStatus === 'pending' && params.batch.status !== 'active') {
    throw new Error(`Batch "${params.batch.batchCode}" is inactive.`);
  }

  const title = params.title.trim().slice(0, 140);
  if (!title) throw new Error('Reminder title is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.dueDate)) {
    throw new Error('Due date must be a valid date (YYYY-MM-DD).');
  }

  const dosageOrAction = params.dosageOrAction.trim().slice(0, 140);
  const notes = params.notes.trim().slice(0, 500);
  const milestoneKey = (params.milestoneKey || '').trim().slice(0, 80);
  const targetAgeDays = computeOptionalTargetAgeDays(
    params.batch,
    params.dueDate,
    params.targetAgeDays
  );

  const isDone = initialStatus === 'completed' || initialStatus === 'dismissed';
  const resolvedDoneDate = isDone
    ? params.completedAtDate && /^\d{4}-\d{2}-\d{2}$/.test(params.completedAtDate)
      ? params.completedAtDate
      : formatDateInTimezone(new Date(), params.timeZone)
    : '';

  const id = generateId('rem');
  const batchWrite = writeBatch(db);
  batchWrite.set(doc(db, 'farms', params.farmId, 'farmReminders', id), {
    id,
    farmId: params.farmId,
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode.slice(0, 60),
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot.slice(0, 80),
    milestoneKey,
    reminderType: params.reminderType,
    title,
    dueDate: params.dueDate,
    targetAgeDays,
    dosageOrAction,
    notes,
    status: initialStatus,
    completedAtDate: resolvedDoneDate,
    completedBy: isDone ? params.actorUid : '',
    completedByName: isDone ? params.actorName.slice(0, 150) : '',
    createdBy: params.actorUid,
    createdByName: params.actorName.slice(0, 150),
    updatedBy: params.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'farmReminders',
    entityId: id,
    action: initialStatus === 'pending' ? 'create' : 'status_change',
    summary:
      initialStatus === 'pending'
        ? `Scheduled ${params.reminderType} reminder "${title}" for ${params.batch.batchCode} due ${params.dueDate}`
        : `Marked ${params.reminderType} "${title}" for ${params.batch.batchCode} as ${initialStatus}`,
    after: {
      batchCode: params.batch.batchCode,
      penName: params.batch.penNameSnapshot,
      reminderType: params.reminderType,
      title,
      dueDate: params.dueDate,
      status: initialStatus,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/farmReminders/${id}`);
  }
}

export async function updateFarmReminderStatus(params: {
  farmId: string;
  reminder: Pick<FarmReminder, 'id' | 'title' | 'batchCodeSnapshot' | 'status'>;
  nextStatus: ReminderStatus;
  completedAtDate?: string;
  timeZone?: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (!VALID_REMINDER_STATUSES.includes(params.nextStatus)) {
    throw new Error('Invalid reminder status.');
  }

  const isDone = params.nextStatus === 'completed' || params.nextStatus === 'dismissed';
  const resolvedDoneDate = isDone
    ? params.completedAtDate && /^\d{4}-\d{2}-\d{2}$/.test(params.completedAtDate)
      ? params.completedAtDate
      : formatDateInTimezone(new Date(), params.timeZone)
    : '';

  const batchWrite = writeBatch(db);
  batchWrite.update(doc(db, 'farms', params.farmId, 'farmReminders', params.reminder.id), {
    status: params.nextStatus,
    completedAtDate: resolvedDoneDate,
    completedBy: isDone ? params.actorUid : '',
    completedByName: isDone ? params.actorName.slice(0, 150) : '',
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'farmReminders',
    entityId: params.reminder.id,
    action: 'status_change',
    summary: `Updated reminder "${params.reminder.title}" (${params.reminder.batchCodeSnapshot}) from ${params.reminder.status} to ${params.nextStatus}`,
    before: { status: params.reminder.status },
    after: { status: params.nextStatus, completedAtDate: resolvedDoneDate },
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
      `farms/${params.farmId}/farmReminders/${params.reminder.id}`
    );
  }
}

export async function updateFarmReminder(params: {
  farmId: string;
  reminder: FarmReminder;
  batch: PoultryBatch;
  reminderType: ReminderType;
  title: string;
  dueDate: string;
  dosageOrAction: string;
  notes: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (!VALID_REMINDER_TYPES.includes(params.reminderType)) {
    throw new Error('Invalid reminder type.');
  }
  const title = params.title.trim().slice(0, 140);
  if (!title) throw new Error('Reminder title is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.dueDate)) {
    throw new Error('Due date must be a valid date (YYYY-MM-DD).');
  }

  const dosageOrAction = params.dosageOrAction.trim().slice(0, 140);
  const notes = params.notes.trim().slice(0, 500);
  const targetAgeDays = computeOptionalTargetAgeDays(params.batch, params.dueDate);

  const batchWrite = writeBatch(db);
  batchWrite.update(doc(db, 'farms', params.farmId, 'farmReminders', params.reminder.id), {
    title,
    reminderType: params.reminderType,
    dueDate: params.dueDate,
    targetAgeDays,
    dosageOrAction,
    notes,
    status: params.reminder.status,
    completedAtDate: params.reminder.completedAtDate,
    completedBy: params.reminder.completedBy,
    completedByName: params.reminder.completedByName,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'farmReminders',
    entityId: params.reminder.id,
    action: 'update',
    summary: `Edited reminder "${title}" (${params.batch.batchCode}) due ${params.dueDate}`,
    before: {
      title: params.reminder.title,
      reminderType: params.reminder.reminderType,
      dueDate: params.reminder.dueDate,
    },
    after: {
      title,
      reminderType: params.reminderType,
      dueDate: params.dueDate,
    },
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
      `farms/${params.farmId}/farmReminders/${params.reminder.id}`
    );
  }
}

export function subscribeFarmReminders(
  farmId: string,
  onData: (reminders: FarmReminder[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 500
) {
  const path = `farms/${farmId}/farmReminders`;
  const q = query(
    collection(db, 'farms', farmId, 'farmReminders'),
    orderBy('dueDate', 'asc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FarmReminder)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}
