import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, where,
} from 'firebase/firestore';
import { calculateBirdAgeDays, calculateEggCounts, generateId } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { EggProductionEntry, FarmMember, PoultryBatch, ProductionRecord } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

const parentIdFor = (batchId: string, date: string) => `prod_parent_${batchId}_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_');
const productionRef = (farmId: string, id: string) => doc(db, 'farms', farmId, 'eggProduction', id);
const parentRef = (farmId: string, id: string) => doc(db, 'farms', farmId, 'productionRecords', id);
const operationalStatus = (entry: Pick<EggProductionEntry, 'status'>) => entry.status === undefined || entry.status === 'APPROVED';

function validateCounts(params: { crates: number; pieces: number; crackedEggs: number; damagedEggs: number }) {
  if ([params.crates, params.pieces, params.crackedEggs, params.damagedEggs].some((v) => !Number.isInteger(v) || v < 0)) {
    throw new Error('Egg counts must be non-negative whole numbers.');
  }
  return calculateEggCounts(params);
}

export async function createEggProduction(params: {
  farmId: string; transactionDate: string; transactionTime: string; batch: PoultryBatch;
  crates: number; pieces: number; crackedEggs: number; damagedEggs: number; remarks: string;
  actorUid: string; actorName: string;
}): Promise<string> {
  if (params.batch.status !== 'active') throw new Error(`Batch "${params.batch.batchCode}" is inactive and cannot accept new production entries.`);
  const counts = validateCounts(params);
  const birdAgeDaysAtTransaction = calculateBirdAgeDays({ hatchDate: params.batch.hatchDate, placementDate: params.batch.placementDate, ageAtPlacementDays: params.batch.ageAtPlacementDays, transactionDate: params.transactionDate });
  const id = generateId('prod');
  const parentId = parentIdFor(params.batch.id, params.transactionDate);
  const child = productionRef(params.farmId, id);
  const parent = parentRef(params.farmId, parentId);
  try {
    await runTransaction(db, async (tx) => {
      const parentSnap = await tx.get(parent);
      if (!parentSnap.exists()) {
        const parentData: ProductionRecord = {
          id: parentId, farmId: params.farmId, batchId: params.batch.id, batchCodeSnapshot: params.batch.batchCode,
          transactionDate: params.transactionDate, status: 'PENDING', createdBy: params.actorUid, createdByName: params.actorName.slice(0, 150),
          createdAt: serverTimestamp(), updatedBy: params.actorUid, updatedAt: serverTimestamp(), approvedBy: '', approvedByName: '', approvedAt: null, approvalAuditId: '',
        };
        tx.set(parent, parentData);
      } else if ((parentSnap.data() as ProductionRecord).status !== 'PENDING') {
        throw new Error('This daily production record is already approved or voided and cannot accept new entries.');
      }
      tx.set(child, {
        id, farmId: params.farmId, parentId, transactionDate: params.transactionDate, transactionTime: params.transactionTime.trim().slice(0, 5),
        batchId: params.batch.id, batchCodeSnapshot: params.batch.batchCode, penId: params.batch.penId, penNameSnapshot: params.batch.penNameSnapshot,
        birdAgeDaysAtTransaction, crates: params.crates, pieces: params.pieces, intactEggs: counts.intactEggs, crackedEggs: params.crackedEggs, damagedEggs: params.damagedEggs,
        totalEggs: counts.totalEggs, remarks: params.remarks.trim().slice(0, 500), isVoided: false, voidReason: '', voidedBy: '', status: 'PENDING',
        approvedBy: '', approvedByName: '', approvedAt: null, approvalAuditId: '', createdBy: params.actorUid, createdByName: params.actorName.slice(0, 150), updatedBy: params.actorUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      const audit = buildAuditLogEntry({ farmId: params.farmId, entityType: 'eggProduction', entityId: id, action: 'create', summary: `Recorded pending production for ${params.batch.batchCode} on ${params.transactionDate}`, after: { parentId, status: 'PENDING', totalEggs: counts.totalEggs }, actorUid: params.actorUid, actorName: params.actorName });
      tx.set(audit.ref, audit.data);
    });
    return id;
  } catch (err) { handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/eggProduction/${id}`); }
}

export async function approveEggProductionParent(params: { farmId: string; parentId: string; actor: FarmMember }): Promise<void> {
  const parent = parentRef(params.farmId, params.parentId);
  try {
    const childQuery = query(collection(db, 'farms', params.farmId, 'eggProduction'), where('parentId', '==', params.parentId), limit(500));
    const childIndex = await getDocs(childQuery);
    const childIds = childIndex.docs.map((d) => d.id);
    await runTransaction(db, async (tx) => {
      const parentSnap = await tx.get(parent);
      if (!parentSnap.exists()) throw new Error('Production parent record no longer exists.');
      const parentData = parentSnap.data() as ProductionRecord;
      if (parentData.status !== 'PENDING') throw new Error('Only pending production can be approved.');
      const childSnaps = await Promise.all(childIds.map((id) => tx.get(productionRef(params.farmId, id))));
      const children = childSnaps.filter((s) => s.exists()).map((s) => s.data() as EggProductionEntry).filter((c) => !c.isVoided);
      if (!children.length) throw new Error('A production parent must contain at least one active child entry.');
      if (children.some((c) => c.status !== 'PENDING')) throw new Error('All active child entries must be pending before approval.');
      const auditId = generateId('audit');
      tx.update(parent, { status: 'APPROVED', approvedBy: params.actor.uid, approvedByName: params.actor.displayName.slice(0, 150), approvedAt: serverTimestamp(), approvalAuditId: auditId, updatedBy: params.actor.uid, updatedAt: serverTimestamp() });
      for (const child of children) tx.update(productionRef(params.farmId, child.id), { status: 'APPROVED', approvedBy: params.actor.uid, approvedByName: params.actor.displayName.slice(0, 150), approvedAt: serverTimestamp(), approvalAuditId: auditId, updatedBy: params.actor.uid, updatedAt: serverTimestamp() });
      const audit = buildAuditLogEntry({ farmId: params.farmId, entityType: 'productionRecord', entityId: params.parentId, action: 'status_change', summary: `Approved production parent ${params.parentId}`, before: { status: 'PENDING', childIds: children.map((c) => c.id) }, after: { status: 'APPROVED', childIds: children.map((c) => c.id), approvingUser: params.actor.uid }, actorUid: params.actor.uid, actorName: params.actor.displayName });
      tx.set(doc(db, 'farms', params.farmId, 'auditLogs', auditId), { ...audit.data, id: auditId });
    });
  } catch (err) { if (err instanceof Error && /pending|child|active|exists/.test(err.message)) throw err; handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/productionRecords/${params.parentId}`); }
}

export async function updateEggProduction(params: {
  farmId: string; entry: EggProductionEntry; batch: PoultryBatch; transactionDate: string; transactionTime: string;
  crates: number; pieces: number; crackedEggs: number; damagedEggs: number; remarks: string; actorUid: string; actorName: string;
}): Promise<void> {
  if (params.entry.isVoided) throw new Error('Voided production records cannot be edited.');
  if (!params.entry.status || params.entry.status === 'APPROVED') throw new Error('This production record has already been approved and is permanently locked against ordinary editing or voiding. Contact the farm owner for an authorized correction.');
  const counts = validateCounts(params);
  const age = calculateBirdAgeDays({ hatchDate: params.batch.hatchDate, placementDate: params.batch.placementDate, ageAtPlacementDays: params.batch.ageAtPlacementDays, transactionDate: params.transactionDate });
  try {
    await runTransaction(db, async (tx) => {
      const ref = productionRef(params.farmId, params.entry.id); const snap = await tx.get(ref); if (!snap.exists()) throw new Error('Production record no longer exists.');
      const current = snap.data() as EggProductionEntry; if (current.status !== 'PENDING' || current.isVoided) throw new Error('Only pending production can be edited.');
      tx.update(ref, { transactionDate: params.transactionDate, transactionTime: params.transactionTime.trim().slice(0, 5), batchId: params.batch.id, batchCodeSnapshot: params.batch.batchCode, penId: params.batch.penId, penNameSnapshot: params.batch.penNameSnapshot, birdAgeDaysAtTransaction: age, crates: params.crates, pieces: params.pieces, intactEggs: counts.intactEggs, crackedEggs: params.crackedEggs, damagedEggs: params.damagedEggs, totalEggs: counts.totalEggs, remarks: params.remarks.trim().slice(0, 500), updatedBy: params.actorUid, updatedAt: serverTimestamp() });
    });
  } catch (err) { if (err instanceof Error && /approved|pending|Voided|exists/.test(err.message)) throw err; handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggProduction/${params.entry.id}`); }
}

export async function voidEggProduction(params: { farmId: string; entry: EggProductionEntry; voidReason: string; actorUid: string; actorName: string }): Promise<void> {
  const reason = params.voidReason.trim(); if (!reason) throw new Error('A void reason is required.'); if (params.entry.isVoided) throw new Error('Entry is already voided.'); if (!params.entry.status || params.entry.status === 'APPROVED') throw new Error('This production record has already been approved and is permanently locked against ordinary editing or voiding. Contact the farm owner for an authorized correction.');
  try { await runTransaction(db, async (tx) => { const ref = productionRef(params.farmId, params.entry.id); const snap = await tx.get(ref); if (!snap.exists() || (snap.data() as EggProductionEntry).status !== 'PENDING') throw new Error('Only pending production can be voided.'); tx.update(ref, { status: 'VOIDED', isVoided: true, voidReason: reason.slice(0, 300), voidedBy: params.actorUid, updatedBy: params.actorUid, updatedAt: serverTimestamp() }); }); }
  catch (err) { if (err instanceof Error && /pending|voided/.test(err.message)) throw err; handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggProduction/${params.entry.id}`); }
}

const normalize = (d: any): EggProductionEntry => ({ ...d, status: d.status || (d.isVoided ? 'VOIDED' : 'APPROVED') });
export function subscribeEggProduction(farmId: string, onData: (entries: EggProductionEntry[]) => void, onError: (err: Error) => void, maxRecords = 500) {
  const q = query(collection(db, 'farms', farmId, 'eggProduction'), orderBy('transactionDate', 'desc'), limit(maxRecords));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => normalize(d.data()))), (err) => { try { handleFirestoreError(err, OperationType.LIST, `farms/${farmId}/eggProduction`); } catch (e) { onError(e as Error); } });
}
export async function fetchEggProductionByDateRange(farmId: string, startDate: string, endDate: string): Promise<EggProductionEntry[]> {
  try { const snap = await getDocs(query(collection(db, 'farms', farmId, 'eggProduction'), where('transactionDate', '>=', startDate), where('transactionDate', '<=', endDate), orderBy('transactionDate', 'desc'))); return snap.docs.map((d) => normalize(d.data())); }
  catch (err) { handleFirestoreError(err, OperationType.LIST, `farms/${farmId}/eggProduction`); }
}
export function subscribeEggProductionByDateRange(farmId: string, startDate: string, endDate: string, onData: (entries: EggProductionEntry[]) => void, onError: (err: Error) => void) {
  const q = query(collection(db, 'farms', farmId, 'eggProduction'), where('transactionDate', '>=', startDate), where('transactionDate', '<=', endDate), orderBy('transactionDate', 'desc'));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => normalize(d.data()))), (err) => { try { handleFirestoreError(err, OperationType.LIST, `farms/${farmId}/eggProduction`); } catch (e) { onError(e as Error); } });
}
