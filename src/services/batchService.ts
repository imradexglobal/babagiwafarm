import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { generateId, toCodeKey } from '../domain/calculations.ts';
import { resolveBatchCareClassification } from '../domain/careSchedule.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { FarmMember, Pen, PoultryBatch } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

export async function createBatch(params: {
  farmId: string;
  batchCode: string;
  penId: string;
  birdType: string;
  animalType?: string;
  productionType?: string;
  productionStage?: string;
  breed: string;
  strain?: string;
  source: string;
  hatchDate: string;
  ageAtPlacementDays: number;
  placementDate: string;
  initialCount: number;
  maleCount: number;
  femaleCount: number;
  remarks: string;
  assignedCarePlanIds?: string[];
  actorUid: string;
  actorName: string;
}): Promise<string> {
  const batchCode = params.batchCode.trim();
  if (!batchCode) throw new Error('Unique batch code/name is required.');
  if (!params.penId) throw new Error('Please select a pen/house.');
  if (!params.placementDate) throw new Error('Placement date is required.');
  if (!params.hatchDate && (!Number.isInteger(params.ageAtPlacementDays) || params.ageAtPlacementDays < 0)) {
    throw new Error('Provide either a hatch date or a valid non-negative age at placement (days).');
  }
  if (!Number.isInteger(params.initialCount) || params.initialCount < 1) {
    throw new Error('Initial bird count must be at least 1.');
  }
  if (
    !Number.isInteger(params.maleCount) ||
    params.maleCount < 0 ||
    !Number.isInteger(params.femaleCount) ||
    params.femaleCount < 0 ||
    params.maleCount + params.femaleCount > params.initialCount
  ) {
    throw new Error('Male + female counts must be non-negative and cannot exceed initial bird count.');
  }

  const batchId = generateId('batch');
  const classification = resolveBatchCareClassification({
    birdType: params.birdType,
    animalType: params.animalType,
    productionType: params.productionType,
    productionStage: params.productionStage,
  });
  const codeKey = toCodeKey(batchCode);
  const penRef = doc(db, 'farms', params.farmId, 'pens', params.penId);
  const codeLockRef = doc(db, 'farms', params.farmId, 'batchCodes', codeKey);
  const batchRef = doc(db, 'farms', params.farmId, 'batches', batchId);

  try {
    await runTransaction(db, async (tx) => {
      const [penSnap, codeSnap] = await Promise.all([tx.get(penRef), tx.get(codeLockRef)]);
      if (!penSnap.exists()) {
        throw new Error('Selected pen does not exist.');
      }
      const pen = penSnap.data() as Pen;
      if (pen.status !== 'active') {
        throw new Error(`Pen "${pen.name}" is inactive and cannot receive a new batch.`);
      }
      if (pen.activeBatchId && pen.activeBatchId !== '') {
        throw new Error(
          `Pen "${pen.name}" already houses an active batch. Deactivate or transfer the existing batch first to prevent overlapping flocks.`
        );
      }
      if (codeSnap.exists()) {
        throw new Error(`Batch code "${batchCode}" is already used in this farm. Batch codes must be unique.`);
      }

      tx.set(codeLockRef, {
        codeKey,
        farmId: params.farmId,
        batchId,
        createdAt: serverTimestamp(),
      });

      tx.update(penRef, {
        activeBatchId: batchId,
        updatedAt: serverTimestamp(),
      });

      tx.set(batchRef, {
        id: batchId,
        farmId: params.farmId,
        batchCode: batchCode.slice(0, 60),
        penId: pen.id,
        penNameSnapshot: pen.name.slice(0, 80),
        birdType: (params.birdType.trim() || 'Layer').slice(0, 60),
        animalType: (params.animalType?.trim() || classification.animalType).slice(0, 80),
        productionType: (params.productionType?.trim() || classification.productionType).slice(0, 80),
        productionStage: (params.productionStage?.trim() || classification.productionStage).slice(0, 80),
        breed: params.breed.trim().slice(0, 80),
        strain: (params.strain || '').trim().slice(0, 80),
        source: params.source.trim().slice(0, 120),
        hatchDate: params.hatchDate.trim(),
        ageAtPlacementDays: params.hatchDate ? 0 : params.ageAtPlacementDays,
        placementDate: params.placementDate,
        initialCount: params.initialCount,
        maleCount: params.maleCount,
        femaleCount: params.femaleCount,
        remarks: params.remarks.trim().slice(0, 500),
        status: 'active',
        assignedCarePlanIds: params.assignedCarePlanIds || [],
        createdBy: params.actorUid,
        createdByName: params.actorName.slice(0, 150),
        updatedBy: params.actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const audit = buildAuditLogEntry({
        farmId: params.farmId,
        entityType: 'batch',
        entityId: batchId,
        action: 'create',
        summary: `Placed batch ${batchCode} (${params.initialCount} birds) in ${pen.name}`,
        after: { batchCode, penId: pen.id, penName: pen.name, initialCount: params.initialCount },
        actorUid: params.actorUid,
        actorName: params.actorName,
      });
      tx.set(audit.ref, audit.data);
    });
    return batchId;
  } catch (err) {
    if (err instanceof Error && !err.message.toLowerCase().includes('permission')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/batches/${batchId}`);
  }
}

export async function updateBatch(params: {
  farmId: string;
  batch: PoultryBatch;
  penId: string;
  birdType: string;
  animalType?: string;
  productionType?: string;
  productionStage?: string;
  breed: string;
  strain?: string;
  source: string;
  hatchDate: string;
  ageAtPlacementDays: number;
  placementDate: string;
  initialCount: number;
  maleCount: number;
  femaleCount: number;
  remarks: string;
  status: 'active' | 'inactive';
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (!Number.isInteger(params.initialCount) || params.initialCount < 1) {
    throw new Error('Initial count must be at least 1.');
  }
  if (params.maleCount + params.femaleCount > params.initialCount) {
    throw new Error('Male + female counts cannot exceed initial count.');
  }

  const classification = resolveBatchCareClassification({
    birdType: params.birdType,
    animalType: params.animalType,
    productionType: params.productionType,
    productionStage: params.productionStage,
  });

  const batchRef = doc(db, 'farms', params.farmId, 'batches', params.batch.id);
  const oldPenRef = doc(db, 'farms', params.farmId, 'pens', params.batch.penId);
  const newPenRef = doc(db, 'farms', params.farmId, 'pens', params.penId);

  try {
    await runTransaction(db, async (tx) => {
      const [batchSnap, oldPenSnap, newPenSnap] = await Promise.all([
        tx.get(batchRef),
        tx.get(oldPenRef),
        params.penId === params.batch.penId ? Promise.resolve(null) : tx.get(newPenRef),
      ]);
      if (!batchSnap.exists()) throw new Error('Batch not found.');
      const current = batchSnap.data() as PoultryBatch;
      const targetPen = (newPenSnap ? newPenSnap.data() : oldPenSnap.data()) as Pen | undefined;
      if (!targetPen) throw new Error('Selected pen does not exist.');

      if (params.status === 'active') {
        if (targetPen.status !== 'active') {
          throw new Error(`Target pen "${targetPen.name}" is inactive.`);
        }
        if (targetPen.activeBatchId && targetPen.activeBatchId !== current.id) {
          throw new Error(
            `Target pen "${targetPen.name}" already houses another active batch. Deactivate that batch first.`
          );
        }
      }

      // Release old pen if changing pen or deactivating
      if (oldPenSnap.exists()) {
        const oldPen = oldPenSnap.data() as Pen;
        if (oldPen.activeBatchId === current.id && (params.status === 'inactive' || params.penId !== current.penId)) {
          tx.update(oldPenRef, { activeBatchId: '', updatedAt: serverTimestamp() });
        }
      }

      // Occupy target pen if active
      if (params.status === 'active') {
        tx.update(newPenRef, { activeBatchId: current.id, updatedAt: serverTimestamp() });
      }

      const updates = {
        penId: targetPen.id,
        penNameSnapshot: targetPen.name.slice(0, 80),
        birdType: (params.birdType.trim() || 'Layer').slice(0, 60),
        animalType: (params.animalType?.trim() || classification.animalType).slice(0, 80),
        productionType: (params.productionType?.trim() || classification.productionType).slice(0, 80),
        productionStage: (params.productionStage?.trim() || classification.productionStage).slice(0, 80),
        breed: params.breed.trim().slice(0, 80),
        strain: (params.strain || '').trim().slice(0, 80),
        source: params.source.trim().slice(0, 120),
        hatchDate: params.hatchDate.trim(),
        ageAtPlacementDays: params.hatchDate ? 0 : params.ageAtPlacementDays,
        placementDate: params.placementDate,
        initialCount: params.initialCount,
        maleCount: params.maleCount,
        femaleCount: params.femaleCount,
        remarks: params.remarks.trim().slice(0, 500),
        status: params.status,
        updatedBy: params.actorUid,
        updatedAt: serverTimestamp(),
      };
      tx.update(batchRef, updates);

      const audit = buildAuditLogEntry({
        farmId: params.farmId,
        entityType: 'batch',
        entityId: current.id,
        action: current.status !== params.status ? 'status_change' : 'update',
        summary: `Updated batch ${current.batchCode} (${params.status})`,
        before: {
          penId: current.penId,
          penNameSnapshot: current.penNameSnapshot,
          initialCount: current.initialCount,
          status: current.status,
        },
        after: {
          penId: updates.penId,
          penNameSnapshot: updates.penNameSnapshot,
          initialCount: updates.initialCount,
          status: updates.status,
        },
        actorUid: params.actorUid,
        actorName: params.actorName,
      });
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    if (err instanceof Error && !err.message.toLowerCase().includes('permission')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/batches/${params.batch.id}`);
  }
}

export async function deactivateBatch(params: {
  farmId: string;
  batch: PoultryBatch;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const batchRef = doc(db, 'farms', params.farmId, 'batches', params.batch.id);
  const penRef = doc(db, 'farms', params.farmId, 'pens', params.batch.penId);

  try {
    await runTransaction(db, async (tx) => {
      const penSnap = await tx.get(penRef);
      if (penSnap.exists() && (penSnap.data() as Pen).activeBatchId === params.batch.id) {
        tx.update(penRef, { activeBatchId: '', updatedAt: serverTimestamp() });
      }
      tx.update(batchRef, {
        status: 'inactive',
        updatedBy: params.actorUid,
        updatedAt: serverTimestamp(),
      });
      const audit = buildAuditLogEntry({
        farmId: params.farmId,
        entityType: 'batch',
        entityId: params.batch.id,
        action: 'status_change',
        summary: `Deactivated batch ${params.batch.batchCode} (historical records preserved)`,
        before: { status: params.batch.status },
        after: { status: 'inactive' },
        actorUid: params.actorUid,
        actorName: params.actorName,
      });
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/batches/${params.batch.id}`);
  }
}

export async function archiveUnusedBatch(params: { farmId: string; batch: PoultryBatch; actorUid: string; actorName: string }): Promise<void> {
  const names = ['eggProduction','feedConsumption','eggSales','farmPurchases','mortalityEntries','medicationLogs','environmentLogs','farmReminders','eggTransfers','eggStoreReceipts'];
  const checks = await Promise.all(names.map((name) => getDocs(query(collection(db, 'farms', params.farmId, name), where('batchId', '==', params.batch.id), limit(1)))))
  if (checks.some((snap) => !snap.empty)) throw new Error('This batch has usage or historical records. Use Deactivate to preserve its history.');
  await deactivateBatch(params);
}

export async function closeoutBatch(params: {
  farmId: string;
  batch: PoultryBatch;
  closedDate: string;
  finalLiveBirdCount: number;
  closeoutReason: NonNullable<PoultryBatch['closeoutReason']>;
  averageBirdWeightKg: number;
  summary: NonNullable<PoultryBatch['closeoutSummary']>;
  member: FarmMember;
}): Promise<void> {
  if (params.member.role !== 'owner') throw new Error('Only the farm owner can close out a flock.');
  if (params.batch.status !== 'active') throw new Error('Only an active flock can be closed out.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.closedDate)) throw new Error('Enter a valid closeout date.');
  if (!Number.isInteger(params.finalLiveBirdCount) || params.finalLiveBirdCount < 0 || params.finalLiveBirdCount > params.batch.initialCount) throw new Error('Final live bird count must be between zero and the initial flock count.');
  if (!Number.isFinite(params.averageBirdWeightKg) || params.averageBirdWeightKg < 0 || params.averageBirdWeightKg > 100) throw new Error('Average live bird weight must be a valid value from 0 to 100 kg.');

  const batchRef = doc(db, 'farms', params.farmId, 'batches', params.batch.id);
  const penRef = doc(db, 'farms', params.farmId, 'pens', params.batch.penId);
  try {
    await runTransaction(db, async (tx) => {
      const [batchSnap, penSnap] = await Promise.all([tx.get(batchRef), tx.get(penRef)]);
      if (!batchSnap.exists()) throw new Error('The flock no longer exists.');
      const current = batchSnap.data() as PoultryBatch;
      if (current.status !== 'active') throw new Error('This flock has already been closed or deactivated.');
      const audit = buildAuditLogEntry({
        farmId: params.farmId, entityType: 'batch', entityId: params.batch.id, action: 'status_change',
        summary: `Closed out flock ${current.batchCode} (${params.closeoutReason})`,
        before: { status: current.status },
        after: { status: 'inactive', closedDate: params.closedDate, finalLiveBirdCount: params.finalLiveBirdCount, closeoutReason: params.closeoutReason, averageBirdWeightKg: params.averageBirdWeightKg, ...params.summary },
        actorUid: params.member.uid, actorName: params.member.displayName,
      });
      tx.update(batchRef, {
        status: 'inactive', closedDate: params.closedDate, finalLiveBirdCount: params.finalLiveBirdCount,
        closeoutReason: params.closeoutReason, averageBirdWeightKg: params.averageBirdWeightKg,
        closeoutSummary: params.summary, updatedBy: params.member.uid, updatedAt: serverTimestamp(),
      });
      if (penSnap.exists() && (penSnap.data() as Pen).activeBatchId === current.id) tx.update(penRef, { activeBatchId: '', updatedAt: serverTimestamp() });
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    if (err instanceof Error && /Only the farm owner|active flock|valid closeout|Final live|Average live|no longer exists|already been closed/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/batches/${params.batch.id}`);
  }
}

export function subscribeBatches(
  farmId: string,
  onData: (batches: PoultryBatch[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/batches`;
  const q = query(collection(db, 'farms', farmId, 'batches'), orderBy('placementDate', 'desc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as PoultryBatch)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

