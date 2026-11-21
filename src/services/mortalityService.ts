import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { calculateBirdAgeDays, generateId } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { MortalityEntry, PoultryBatch, TimeOfDay } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

const VALID_TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'afternoon', 'night'];

async function getBatchLossesExcludingEntry(
  farmId: string,
  batchId: string,
  excludeEntryId?: string
): Promise<number> {
  const path = `farms/${farmId}/mortalityEntries`;
  const q = query(
    collection(db, 'farms', farmId, 'mortalityEntries'),
    where('batchId', '==', batchId)
  );
  try {
    const snap = await getDocs(q);
    let total = 0;
    for (const d of snap.docs) {
      const data = d.data() as MortalityEntry;
      if (!data.isVoided && data.id !== excludeEntryId) {
        total += data.mortalityCount;
      }
    }
    return total;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createMortalityEntry(params: {
  farmId: string;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  batch: PoultryBatch;
  mortalityCount: number;
  reasonCategory: string;
  reasonDetail: string;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (params.batch.status !== 'active') {
    throw new Error(
      `Batch "${params.batch.batchCode}" is inactive and cannot accept new mortality entries.`
    );
  }
  if (!VALID_TIMES_OF_DAY.includes(params.timeOfDay)) {
    throw new Error('Time of day must be Morning, Afternoon, or Night.');
  }
  if (!Number.isInteger(params.mortalityCount) || params.mortalityCount < 1) {
    throw new Error('Mortality count must be a whole number of at least 1.');
  }

  const reasonCategory = params.reasonCategory.trim().slice(0, 80);
  const reasonDetail = params.reasonDetail.trim().slice(0, 300);
  if (!reasonCategory) {
    throw new Error('Please select a reason for death.');
  }
  if (reasonCategory === 'Others' && !reasonDetail) {
    throw new Error('Please specify the reason details when "Others" is selected.');
  }

  const birdAgeDaysAtTransaction = calculateBirdAgeDays({
    hatchDate: params.batch.hatchDate,
    placementDate: params.batch.placementDate,
    ageAtPlacementDays: params.batch.ageAtPlacementDays,
    transactionDate: params.transactionDate,
  });

  const existingLosses = await getBatchLossesExcludingEntry(params.farmId, params.batch.id);
  const remainingBirds = Math.max(0, params.batch.initialCount - existingLosses);
  if (params.mortalityCount > remainingBirds) {
    throw new Error(
      `Cannot record ${params.mortalityCount} losses: only ${remainingBirds.toLocaleString()} birds remain in batch "${params.batch.batchCode}".`
    );
  }

  const id = generateId('mort');
  const batchWrite = writeBatch(db);
  const ref = doc(db, 'farms', params.farmId, 'mortalityEntries', id);

  const mortalityParentId = `mort_parent_${params.batch.id}_${params.transactionDate}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  batchWrite.set(ref, {
    id,
    farmId: params.farmId,
    parentId: mortalityParentId,
    transactionDate: params.transactionDate,
    timeOfDay: params.timeOfDay,
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode,
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot,
    birdAgeDaysAtTransaction,
    mortalityCount: params.mortalityCount,
    reasonCategory,
    reasonDetail,
    remarks: params.remarks.trim().slice(0, 500),
    isVoided: false,
    voidReason: '',
    voidedBy: '',
    status: 'APPROVED',
    approvedBy: params.actorUid,
    approvedByName: params.actorName.slice(0, 150),
    approvedAt: serverTimestamp(),
    approvalAuditId: '',
    createdBy: params.actorUid,
    createdByName: params.actorName.slice(0, 150),
    updatedBy: params.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'mortalityEntries',
    entityId: id,
    action: 'create',
    summary: `Recorded ${params.mortalityCount} bird loss(es) (${params.timeOfDay}, ${reasonCategory}) for ${params.batch.batchCode} on ${params.transactionDate}`,
    after: {
      transactionDate: params.transactionDate,
      timeOfDay: params.timeOfDay,
      batchCode: params.batch.batchCode,
      penName: params.batch.penNameSnapshot,
      mortalityCount: params.mortalityCount,
      reasonCategory,
      reasonDetail,
      birdAgeDaysAtTransaction,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/mortalityEntries/${id}`);
  }
}

export async function updateMortalityEntry(params: {
  farmId: string;
  entry: MortalityEntry;
  batch: PoultryBatch;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  mortalityCount: number;
  reasonCategory: string;
  reasonDetail: string;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.entry.isVoided) {
    throw new Error('Voided mortality records cannot be edited.');
  }
  if (!VALID_TIMES_OF_DAY.includes(params.timeOfDay)) {
    throw new Error('Time of day must be Morning, Afternoon, or Night.');
  }
  if (!Number.isInteger(params.mortalityCount) || params.mortalityCount < 1) {
    throw new Error('Mortality count must be a whole number of at least 1.');
  }

  const reasonCategory = params.reasonCategory.trim().slice(0, 80);
  const reasonDetail = params.reasonDetail.trim().slice(0, 300);
  if (!reasonCategory) {
    throw new Error('Please select a reason for death.');
  }
  if (reasonCategory === 'Others' && !reasonDetail) {
    throw new Error('Please specify the reason details when "Others" is selected.');
  }

  const birdAgeDaysAtTransaction = calculateBirdAgeDays({
    hatchDate: params.batch.hatchDate,
    placementDate: params.batch.placementDate,
    ageAtPlacementDays: params.batch.ageAtPlacementDays,
    transactionDate: params.transactionDate,
  });

  const otherLosses = await getBatchLossesExcludingEntry(
    params.farmId,
    params.batch.id,
    params.entry.id
  );
  const remainingBirds = Math.max(0, params.batch.initialCount - otherLosses);
  if (params.mortalityCount > remainingBirds) {
    throw new Error(
      `Cannot update loss count to ${params.mortalityCount}: only ${remainingBirds.toLocaleString()} surviving birds available in batch "${params.batch.batchCode}".`
    );
  }

  const batchWrite = writeBatch(db);
  const updates = {
    transactionDate: params.transactionDate,
    timeOfDay: params.timeOfDay,
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode,
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot,
    birdAgeDaysAtTransaction,
    mortalityCount: params.mortalityCount,
    reasonCategory,
    reasonDetail,
    remarks: params.remarks.trim().slice(0, 500),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };

  batchWrite.update(
    doc(db, 'farms', params.farmId, 'mortalityEntries', params.entry.id),
    updates
  );

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'mortalityEntries',
    entityId: params.entry.id,
    action: 'update',
    summary: `Updated mortality entry on ${params.transactionDate} (${params.batch.batchCode}, ${params.mortalityCount} bird(s))`,
    before: {
      transactionDate: params.entry.transactionDate,
      timeOfDay: params.entry.timeOfDay,
      batchCode: params.entry.batchCodeSnapshot,
      mortalityCount: params.entry.mortalityCount,
      reasonCategory: params.entry.reasonCategory,
      reasonDetail: params.entry.reasonDetail,
    },
    after: {
      transactionDate: updates.transactionDate,
      timeOfDay: updates.timeOfDay,
      batchCode: updates.batchCodeSnapshot,
      mortalityCount: updates.mortalityCount,
      reasonCategory: updates.reasonCategory,
      reasonDetail: updates.reasonDetail,
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
      `farms/${params.farmId}/mortalityEntries/${params.entry.id}`
    );
  }
}

export async function voidMortalityEntry(params: {
  farmId: string;
  entry: MortalityEntry;
  voidReason: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('A void reason is required.');
  if (params.entry.isVoided) throw new Error('Entry is already voided.');

  const batchWrite = writeBatch(db);
  batchWrite.update(doc(db, 'farms', params.farmId, 'mortalityEntries', params.entry.id), {
    isVoided: true,
    voidReason: reason.slice(0, 300),
    voidedBy: params.actorUid,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'mortalityEntries',
    entityId: params.entry.id,
    action: 'void',
    summary: `Voided mortality entry (${params.entry.mortalityCount} bird(s) in ${params.entry.batchCodeSnapshot} on ${params.entry.transactionDate}): ${reason}`,
    before: { isVoided: false, mortalityCount: params.entry.mortalityCount },
    after: { isVoided: true, voidReason: reason },
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
      `farms/${params.farmId}/mortalityEntries/${params.entry.id}`
    );
  }
}

export function subscribeMortalityEntries(
  farmId: string,
  onData: (entries: MortalityEntry[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 1000
) {
  const path = `farms/${farmId}/mortalityEntries`;
  const q = query(
    collection(db, 'farms', farmId, 'mortalityEntries'),
    orderBy('transactionDate', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as MortalityEntry)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function fetchMortalityByDateRange(
  farmId: string,
  startDate: string,
  endDate: string
): Promise<MortalityEntry[]> {
  const path = `farms/${farmId}/mortalityEntries`;
  const q = query(
    collection(db, 'farms', farmId, 'mortalityEntries'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as MortalityEntry);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeMortalityByDateRange(
  farmId: string,
  startDate: string,
  endDate: string,
  onData: (entries: MortalityEntry[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/mortalityEntries`;
  const q = query(
    collection(db, 'farms', farmId, 'mortalityEntries'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as MortalityEntry)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}
