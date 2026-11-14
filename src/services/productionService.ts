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
import {
  calculateBirdAgeDays,
  calculateEggCounts,
  generateId,
} from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { EggProductionEntry, PoultryBatch } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

export async function createEggProduction(params: {
  farmId: string;
  transactionDate: string;
  transactionTime: string;
  batch: PoultryBatch;
  crates: number;
  pieces: number;
  crackedEggs: number;
  damagedEggs: number;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (params.batch.status !== 'active') {
    throw new Error(`Batch "${params.batch.batchCode}" is inactive and cannot accept new production entries.`);
  }

  const { intactEggs, totalEggs } = calculateEggCounts({
    crates: params.crates,
    pieces: params.pieces,
    crackedEggs: params.crackedEggs,
    damagedEggs: params.damagedEggs,
  });

  const birdAgeDaysAtTransaction = calculateBirdAgeDays({
    hatchDate: params.batch.hatchDate,
    placementDate: params.batch.placementDate,
    ageAtPlacementDays: params.batch.ageAtPlacementDays,
    transactionDate: params.transactionDate,
  });

  const id = generateId('prod');
  const batchWrite = writeBatch(db);
  const ref = doc(db, 'farms', params.farmId, 'eggProduction', id);

  batchWrite.set(ref, {
    id,
    farmId: params.farmId,
    transactionDate: params.transactionDate,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode,
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot,
    birdAgeDaysAtTransaction,
    crates: params.crates,
    pieces: params.pieces,
    intactEggs,
    crackedEggs: params.crackedEggs,
    damagedEggs: params.damagedEggs,
    totalEggs,
    remarks: params.remarks.trim().slice(0, 500),
    isVoided: false,
    voidReason: '',
    voidedBy: '',
    createdBy: params.actorUid,
    createdByName: params.actorName.slice(0, 150),
    updatedBy: params.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'eggProduction',
    entityId: id,
    action: 'create',
    summary: `Recorded ${totalEggs} eggs (${params.crates} crates + ${params.pieces} pcs) for ${params.batch.batchCode} on ${params.transactionDate}`,
    after: {
      transactionDate: params.transactionDate,
      batchCode: params.batch.batchCode,
      intactEggs,
      crackedEggs: params.crackedEggs,
      damagedEggs: params.damagedEggs,
      totalEggs,
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
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/eggProduction/${id}`);
  }
}

export async function updateEggProduction(params: {
  farmId: string;
  entry: EggProductionEntry;
  batch: PoultryBatch;
  transactionDate: string;
  transactionTime: string;
  crates: number;
  pieces: number;
  crackedEggs: number;
  damagedEggs: number;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.entry.isVoided) {
    throw new Error('Voided production records cannot be edited.');
  }
  const { intactEggs, totalEggs } = calculateEggCounts({
    crates: params.crates,
    pieces: params.pieces,
    crackedEggs: params.crackedEggs,
    damagedEggs: params.damagedEggs,
  });

  const birdAgeDaysAtTransaction = calculateBirdAgeDays({
    hatchDate: params.batch.hatchDate,
    placementDate: params.batch.placementDate,
    ageAtPlacementDays: params.batch.ageAtPlacementDays,
    transactionDate: params.transactionDate,
  });

  const batchWrite = writeBatch(db);
  const updates = {
    transactionDate: params.transactionDate,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode,
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot,
    birdAgeDaysAtTransaction,
    crates: params.crates,
    pieces: params.pieces,
    intactEggs,
    crackedEggs: params.crackedEggs,
    damagedEggs: params.damagedEggs,
    totalEggs,
    remarks: params.remarks.trim().slice(0, 500),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };

  batchWrite.update(doc(db, 'farms', params.farmId, 'eggProduction', params.entry.id), updates);

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'eggProduction',
    entityId: params.entry.id,
    action: 'update',
    summary: `Edited egg production entry on ${params.transactionDate} (${params.batch.batchCode})`,
    before: {
      transactionDate: params.entry.transactionDate,
      batchCode: params.entry.batchCodeSnapshot,
      crates: params.entry.crates,
      pieces: params.entry.pieces,
      intactEggs: params.entry.intactEggs,
      crackedEggs: params.entry.crackedEggs,
      damagedEggs: params.entry.damagedEggs,
      totalEggs: params.entry.totalEggs,
    },
    after: {
      transactionDate: updates.transactionDate,
      batchCode: updates.batchCodeSnapshot,
      crates: updates.crates,
      pieces: updates.pieces,
      intactEggs: updates.intactEggs,
      crackedEggs: updates.crackedEggs,
      damagedEggs: updates.damagedEggs,
      totalEggs: updates.totalEggs,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggProduction/${params.entry.id}`);
  }
}

export async function voidEggProduction(params: {
  farmId: string;
  entry: EggProductionEntry;
  voidReason: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('A void reason is required.');
  if (params.entry.isVoided) throw new Error('Entry is already voided.');

  const batchWrite = writeBatch(db);
  batchWrite.update(doc(db, 'farms', params.farmId, 'eggProduction', params.entry.id), {
    isVoided: true,
    voidReason: reason.slice(0, 300),
    voidedBy: params.actorUid,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'eggProduction',
    entityId: params.entry.id,
    action: 'void',
    summary: `Voided egg production (${params.entry.totalEggs} eggs on ${params.entry.transactionDate}): ${reason}`,
    before: { isVoided: false, totalEggs: params.entry.totalEggs },
    after: { isVoided: true, voidReason: reason },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggProduction/${params.entry.id}`);
  }
}

export function subscribeEggProduction(
  farmId: string,
  onData: (entries: EggProductionEntry[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 500
) {
  const path = `farms/${farmId}/eggProduction`;
  const q = query(
    collection(db, 'farms', farmId, 'eggProduction'),
    orderBy('transactionDate', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as EggProductionEntry)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function fetchEggProductionByDateRange(
  farmId: string,
  startDate: string,
  endDate: string
): Promise<EggProductionEntry[]> {
  const path = `farms/${farmId}/eggProduction`;
  const q = query(
    collection(db, 'farms', farmId, 'eggProduction'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as EggProductionEntry);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeEggProductionByDateRange(
  farmId: string,
  startDate: string,
  endDate: string,
  onData: (entries: EggProductionEntry[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/eggProduction`;
  const q = query(
    collection(db, 'farms', farmId, 'eggProduction'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as EggProductionEntry)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

