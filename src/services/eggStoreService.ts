import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { generateId } from '../domain/calculations.ts';
import {
  totalEggQuantities,
  validateInventoryDelta,
  validateSortingReconciliation,
  validateTransferQuantities,
} from '../domain/eggStore.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { EggProductionEntry, FarmMember } from '../types/farm.ts';
import type {
  EggGrade,
  EggInventoryBalance,
  EggInventoryMovement,
  EggInventoryOrganization,
  EggInventoryMovement as EggMovement,
  EggInventoryBalance as EggBalance,
  EggGradingMode,
  EggQuantities,
  EggSalesMode,
  EggSortingBatch,
  EggStockCategory,
  EggStoreReceipt,
  EggStoreSettings,
  EggTransfer,
} from '../types/eggStore.ts';

const ROOT = (farmId: string) => ['farms', farmId] as const;
const DEFAULT_SETTINGS = (farmId: string, actorUid: string): EggStoreSettings => ({
  id: 'current',
  farmId,
  salesMode: 'phantom',
  inventoryOrganization: 'mixed',
  gradingMode: 'graded',
  grades: ['Jumbo', 'Big', 'Medium', 'Small', 'Pullet', 'Unsorted'],
  allowCrackedSales: false,
  allowDamagedSales: false,
  openingStockCompleted: false,
  createdBy: actorUid,
  updatedBy: actorUid,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

export function defaultEggStoreSettings(farmId: string, actorUid: string): EggStoreSettings {
  return DEFAULT_SETTINGS(farmId, actorUid);
}

export async function saveEggStoreSettings(params: {
  farmId: string;
  current?: EggStoreSettings | null;
  salesMode: EggSalesMode;
  inventoryOrganization: EggInventoryOrganization;
  gradingMode: EggGradingMode;
  grades: EggGrade[];
  allowCrackedSales: boolean;
  allowDamagedSales: boolean;
  actorUid: string;
}): Promise<void> {
  if (params.salesMode === 'true_inventory' && !params.current?.openingStockCompleted) {
    throw new Error('Record and verify the physical opening stock before enabling True Egg Sales.');
  }
  if (!params.grades.length || params.grades.length > 6 || new Set(params.grades).size !== params.grades.length) {
    throw new Error('Select one or more unique egg grades.');
  }
  const ref = doc(db, ...ROOT(params.farmId), 'eggStoreSettings', 'current');
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const previous = snap.exists() ? (snap.data() as EggStoreSettings) : null;
      if (params.salesMode === 'true_inventory' && !previous?.openingStockCompleted) {
        throw new Error('Opening stock must be posted before True Egg Sales can be enabled.');
      }
      const next = {
        ...(previous || DEFAULT_SETTINGS(params.farmId, params.actorUid)),
        salesMode: params.salesMode,
        inventoryOrganization: params.inventoryOrganization,
        gradingMode: params.gradingMode,
        grades: params.grades,
        allowCrackedSales: params.allowCrackedSales,
        allowDamagedSales: params.allowDamagedSales,
        updatedBy: params.actorUid,
        updatedAt: serverTimestamp(),
      };
      tx.set(ref, next);
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Opening stock')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggStoreSettings/current`);
  }
}

export function subscribeEggStoreSettings(
  farmId: string,
  onData: (settings: EggStoreSettings | null) => void,
  onError: (err: Error) => void
) {
  const ref = doc(db, ...ROOT(farmId), 'eggStoreSettings', 'current');
  return onSnapshot(ref, (snap) => onData(snap.exists() ? (snap.data() as EggStoreSettings) : null), (err) => {
    try { handleFirestoreError(err, OperationType.GET, `farms/${farmId}/eggStoreSettings/current`); }
    catch (e) { onError(e as Error); }
  });
}

function subscribeCollection<T>(farmId: string, path: string, onData: (items: T[]) => void, onError: (err: Error) => void) {
  const ref = collection(db, ...ROOT(farmId), path);
  const q = query(ref, orderBy('createdAt', 'desc'), limit(1000));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => d.data() as T)), (err) => {
    try { handleFirestoreError(err, OperationType.LIST, `farms/${farmId}/${path}`); }
    catch (e) { onError(e as Error); }
  });
}

export const subscribeEggTransfers = (farmId: string, onData: (v: EggTransfer[]) => void, onError: (e: Error) => void) => subscribeCollection(farmId, 'eggTransfers', onData, onError);
export function subscribeEggStoreReceipts(farmId: string, onData: (v: EggStoreReceipt[]) => void, onError: (e: Error) => void) {
  const path = `farms/${farmId}/eggStoreReceipts`;
  const q = query(collection(db, 'farms', farmId, 'eggStoreReceipts'), orderBy('receivedAt', 'desc'), limit(1000));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => d.data() as EggStoreReceipt)), (err) => {
    try { handleFirestoreError(err, OperationType.LIST, path); } catch (e) { onError(e as Error); }
  });
}
export const subscribeEggSortingBatches = (farmId: string, onData: (v: EggSortingBatch[]) => void, onError: (e: Error) => void) => subscribeCollection(farmId, 'eggSortingBatches', onData, onError);
export const subscribeEggInventoryMovements = (farmId: string, onData: (v: EggInventoryMovement[]) => void, onError: (e: Error) => void) => subscribeCollection(farmId, 'eggInventoryMovements', onData, onError);

export function subscribeEggInventoryBalances(farmId: string, onData: (v: EggInventoryBalance[]) => void, onError: (e: Error) => void) {
  const ref = collection(db, ...ROOT(farmId), 'eggInventoryBalances');
  return onSnapshot(ref, (snap) => onData(snap.docs.map((d) => d.data() as EggInventoryBalance)), (err) => {
    try { handleFirestoreError(err, OperationType.LIST, `farms/${farmId}/eggInventoryBalances`); }
    catch (e) { onError(e as Error); }
  });
}

export async function postOpeningStock(params: {
  farmId: string;
  lines: { category: EggStockCategory; sourcePenId: string; sourcePenName: string; quantityEggs: number }[];
  transactionDate: string;
  remarks: string;
  actor: FarmMember;
}): Promise<void> {
  if (!params.lines.length) throw new Error('Enter at least one opening stock line.');
  if (!params.remarks.trim()) throw new Error('Opening stock count notes are required.');
  const settingsRef = doc(db, ...ROOT(params.farmId), 'eggStoreSettings', 'current');
  const lineIds = params.lines.map(() => generateId('mv'));
  try {
    await runTransaction(db, async (tx) => {
      const settingsSnap = await tx.get(settingsRef);
      const settings = settingsSnap.exists() ? settingsSnap.data() as EggStoreSettings : DEFAULT_SETTINGS(params.farmId, params.actor.uid);
      if (settings.openingStockCompleted) throw new Error('Opening stock has already been posted. Use an audited adjustment for later corrections.');
      const clean = params.lines.map((line, i) => {
        if (!Number.isInteger(line.quantityEggs) || line.quantityEggs <= 0) throw new Error('Opening stock quantities must be positive whole egg counts.');
        return { ...line, id: lineIds[i], lotId: `open_${lineIds[i]}` };
      });
      const balanceRefs = clean.map((line) => doc(db, ...ROOT(params.farmId), 'eggInventoryBalances', `bal_${line.id}`));
      for (let i = 0; i < clean.length; i += 1) {
        const line = clean[i];
        const balance: EggBalance = {
          id: `bal_${line.id}`, farmId: params.farmId, category: line.category,
          sourcePenId: line.sourcePenId, sourcePenNameSnapshot: line.sourcePenName,
          lotId: line.lotId, balanceEggs: line.quantityEggs, lastMovementId: line.id, updatedAt: serverTimestamp(),
        };
        const movement: EggMovement = {
          id: line.id, farmId: params.farmId, movementType: 'opening_stock', category: line.category,
          balanceId: `bal_${line.id}`,
          quantityDelta: line.quantityEggs, sourcePenId: line.sourcePenId,
          sourcePenNameSnapshot: line.sourcePenName, lotId: line.lotId, productionEntryId: '',
          transferId: '', receiptId: '', sortingBatchId: '', invoiceId: '', invoiceLineId: '',
          reference: 'OPENING STOCK', transactionDate: params.transactionDate, reason: 'Physical opening count',
          remarks: params.remarks.trim().slice(0, 500), actorUid: params.actor.uid,
          actorName: params.actor.displayName.slice(0, 150), createdAt: serverTimestamp(),
        };
        tx.set(balanceRefs[i], balance);
        tx.set(doc(db, ...ROOT(params.farmId), 'eggInventoryMovements', line.id), movement);
      }
      tx.set(settingsRef, {
        ...settings, id: 'current', farmId: params.farmId, openingStockCompleted: true,
        createdBy: settings.createdBy || params.actor.uid, updatedBy: params.actor.uid,
        createdAt: settings.createdAt || serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && /Opening stock|quantities|notes/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `farms/${params.farmId}/eggInventoryBalances`);
  }
}

export async function createProductionTransfer(params: {
  farmId: string;
  productionEntryId: string;
  quantities: EggQuantities;
  reference: string;
  remarks: string;
  actor: FarmMember;
}): Promise<string> {
  const transferId = generateId('etr');
  const productionRef = doc(db, ...ROOT(params.farmId), 'eggProduction', params.productionEntryId);
  const balanceRef = doc(db, ...ROOT(params.farmId), 'eggProductionTransferBalances', params.productionEntryId);
  const transferRef = doc(db, ...ROOT(params.farmId), 'eggTransfers', transferId);
  try {
    await runTransaction(db, async (tx) => {
      const [prodSnap, balanceSnap] = await Promise.all([tx.get(productionRef), tx.get(balanceRef)]);
      if (!prodSnap.exists()) throw new Error('Production entry no longer exists.');
      const p = prodSnap.data() as EggProductionEntry;
      if (p.isVoided) throw new Error('Voided production cannot be transferred.');
      if (p.status !== 'APPROVED' && p.status !== undefined) throw new Error('Only approved production can be transferred to the store.');
      const remaining: EggQuantities = balanceSnap.exists()
        ? { intactEggs: Number(balanceSnap.data().remainingIntactEggs), crackedEggs: Number(balanceSnap.data().remainingCrackedEggs), damagedEggs: Number(balanceSnap.data().remainingDamagedEggs) }
        : { intactEggs: p.intactEggs, crackedEggs: p.crackedEggs, damagedEggs: p.damagedEggs };
      validateTransferQuantities(params.quantities, remaining);
      const next = {
        intactEggs: remaining.intactEggs - params.quantities.intactEggs,
        crackedEggs: remaining.crackedEggs - params.quantities.crackedEggs,
        damagedEggs: remaining.damagedEggs - params.quantities.damagedEggs,
      };
      const data: EggTransfer = {
        id: transferId, farmId: params.farmId, productionEntryId: params.productionEntryId,
        productionDate: p.transactionDate, batchId: p.batchId, batchCodeSnapshot: p.batchCodeSnapshot,
        penId: p.penId, penNameSnapshot: p.penNameSnapshot, quantities: params.quantities,
        totalEggs: totalEggQuantities(params.quantities), reference: params.reference.trim().slice(0, 80),
        remarks: params.remarks.trim().slice(0, 500), status: 'awaiting_receipt',
        transferredBy: params.actor.uid, transferredByName: params.actor.displayName.slice(0, 150),
        receivedBy: '', receivedByName: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      tx.set(transferRef, data);
      tx.set(balanceRef, {
        id: params.productionEntryId, farmId: params.farmId, productionEntryId: params.productionEntryId,
        remainingIntactEggs: next.intactEggs, remainingCrackedEggs: next.crackedEggs,
        remainingDamagedEggs: next.damagedEggs, lastTransferId: transferId,
        updatedBy: params.actor.uid, updatedAt: serverTimestamp(),
      });
    });
    return transferId;
  } catch (err) {
    if (err instanceof Error && /production|Voided|Transfer exceeds|Transfer quantity/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `farms/${params.farmId}/eggTransfers/${transferId}`);
  }
}

export async function receiveEggTransfer(params: {
  farmId: string;
  transfer: EggTransfer;
  actual: EggQuantities;
  transactionDate: string;
  transactionTime: string;
  remarks: string;
  actor: FarmMember;
}): Promise<void> {
  const transferRef = doc(db, ...ROOT(params.farmId), 'eggTransfers', params.transfer.id);
  const receiptRef = doc(db, ...ROOT(params.farmId), 'eggStoreReceipts', params.transfer.id);
  const totalReceived = totalEggQuantities(params.actual);
  const expectedTotal = totalEggQuantities(params.transfer.quantities);
  if (totalReceived <= 0 || totalReceived > expectedTotal) throw new Error(`Received total must be from 1 to ${expectedTotal} eggs.`);
  if (totalReceived !== expectedTotal && !params.remarks.trim()) throw new Error('Explain the total transport variance in the receiving notes.');
  try {
    await runTransaction(db, async (tx) => {
      const [transferSnap, receiptSnap] = await Promise.all([tx.get(transferRef), tx.get(receiptRef)]);
      if (!transferSnap.exists()) throw new Error('Transfer no longer exists.');
      if (receiptSnap.exists()) throw new Error('This transfer has already been received.');
      const t = transferSnap.data() as EggTransfer;
      if (t.status !== 'awaiting_receipt') throw new Error('Only an awaiting transfer can be received.');
      const receipt: EggStoreReceipt = {
        id: t.id, farmId: params.farmId, transferId: t.id, productionEntryId: t.productionEntryId,
        batchId: t.batchId, batchCodeSnapshot: t.batchCodeSnapshot, penId: t.penId,
        penNameSnapshot: t.penNameSnapshot, expected: t.quantities, received: params.actual,
        expectedTotalEggs: expectedTotal, receivedTotalEggs: totalReceived,
        varianceEggs: expectedTotal - totalReceived, remarks: params.remarks.trim().slice(0, 500),
        receivedBy: params.actor.uid, receivedByName: params.actor.displayName.slice(0, 150),
        receivedAt: serverTimestamp(), transactionDate: params.transactionDate,
        transactionTime: params.transactionTime.trim().slice(0, 5),
      };
      const categories: { category: EggStockCategory; quantity: number }[] = [
        { category: 'Unsorted', quantity: params.actual.intactEggs },
        { category: 'Cracked', quantity: params.actual.crackedEggs },
        { category: 'Damaged', quantity: params.actual.damagedEggs },
      ];
      tx.set(receiptRef, receipt);
      tx.update(transferRef, { status: 'received', receivedBy: params.actor.uid, receivedByName: params.actor.displayName.slice(0, 150), updatedAt: serverTimestamp() });
      for (const { category, quantity } of categories) {
        if (quantity <= 0) continue;
        const key = category.toLowerCase();
        const balanceId = `bal_${t.id}_${key}`;
        const lotId = t.id;
        const movementId = `mv_${t.id}_${key}`;
        tx.set(doc(db, ...ROOT(params.farmId), 'eggInventoryBalances', balanceId), {
          id: balanceId, farmId: params.farmId, category, sourcePenId: t.penId,
          sourcePenNameSnapshot: t.penNameSnapshot, lotId, balanceEggs: quantity,
          lastMovementId: movementId, updatedAt: serverTimestamp(),
        } satisfies EggInventoryBalance);
        tx.set(doc(db, ...ROOT(params.farmId), 'eggInventoryMovements', movementId), {
          id: movementId, farmId: params.farmId, movementType: 'store_receipt', category, balanceId,
          quantityDelta: quantity, sourcePenId: t.penId, sourcePenNameSnapshot: t.penNameSnapshot,
          lotId, productionEntryId: t.productionEntryId, transferId: t.id, receiptId: t.id,
          sortingBatchId: '', invoiceId: '', invoiceLineId: '', reference: t.reference,
          transactionDate: params.transactionDate, reason: 'Physical transfer receipt',
          remarks: params.remarks.trim().slice(0, 500), actorUid: params.actor.uid,
          actorName: params.actor.displayName.slice(0, 150), createdAt: serverTimestamp(),
        } satisfies EggInventoryMovement);
      }
    });
  } catch (err) {
    if (err instanceof Error && /already been received|awaiting transfer|variance|Received total/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `farms/${params.farmId}/eggStoreReceipts/${params.transfer.id}`);
  }
}

export async function sortReceivedEggs(params: {
  farmId: string;
  receipt: EggStoreReceipt;
  outputsByGrade: Partial<Record<EggGrade, number>>;
  crackedEggs: number;
  damagedEggs: number;
  transactionDate: string;
  transactionTime: string;
  remarks: string;
  actor: FarmMember;
}): Promise<void> {
  const { inputTotalEggs, outputTotalEggs } = validateSortingReconciliation({
    inputs: params.receipt.received, outputsByGrade: params.outputsByGrade,
    crackedEggs: params.crackedEggs, damagedEggs: params.damagedEggs,
  });
  if (inputTotalEggs !== params.receipt.receivedTotalEggs) throw new Error('Receipt count does not match its stored category totals.');
  const sortingId = params.receipt.id;
  const sortingRef = doc(db, ...ROOT(params.farmId), 'eggSortingBatches', sortingId);
  const inputBalanceRefs = ['unsorted', 'cracked', 'damaged'].map((key) => doc(db, ...ROOT(params.farmId), 'eggInventoryBalances', `bal_${params.receipt.id}_${key}`));
  try {
    await runTransaction(db, async (tx) => {
      const sortingSnap = await tx.get(sortingRef);
      const sourceSnaps = await Promise.all(inputBalanceRefs.map((ref) => tx.get(ref)));
      if (sortingSnap.exists()) throw new Error('This receipt has already been sorted.');
      const expected = [params.receipt.received.intactEggs, params.receipt.received.crackedEggs, params.receipt.received.damagedEggs];
      for (let i = 0; i < 3; i += 1) {
        const bal = sourceSnaps[i];
        if (expected[i] === 0) continue;
        if (!bal.exists() || Number(bal.data().balanceEggs) !== expected[i]) throw new Error('Receipt inventory changed; refresh and reconcile the available stock before sorting.');
      }
      const gradeTotals: Record<EggGrade, number> = {
        Jumbo: Number(params.outputsByGrade.Jumbo || 0), Big: Number(params.outputsByGrade.Big || 0),
        Medium: Number(params.outputsByGrade.Medium || 0), Small: Number(params.outputsByGrade.Small || 0),
        Pullet: Number(params.outputsByGrade.Pullet || 0), Unsorted: Number(params.outputsByGrade.Unsorted || 0),
      };
      const batch: EggSortingBatch = {
        id: sortingId, farmId: params.farmId, receiptId: params.receipt.id,
        sourcePenId: params.receipt.penId, sourcePenNameSnapshot: params.receipt.penNameSnapshot,
        inputs: params.receipt.received, gradeTotals,
        crackedEggs: params.crackedEggs, damagedEggs: params.damagedEggs,
        inputTotalEggs, outputTotalEggs, transactionDate: params.transactionDate,
        transactionTime: params.transactionTime.trim().slice(0, 5), remarks: params.remarks.trim().slice(0, 500),
        sortedBy: params.actor.uid, sortedByName: params.actor.displayName.slice(0, 150), createdAt: serverTimestamp(),
      };
      tx.set(sortingRef, batch);
      for (let i = 0; i < inputBalanceRefs.length; i += 1) {
        if (expected[i] > 0) {
          const categoryKey = ['unsorted', 'cracked', 'damaged'][i];
          tx.update(inputBalanceRefs[i], { balanceEggs: 0, lastMovementId: `mv_${sortingId}_out_${categoryKey}`, updatedAt: serverTimestamp() });
        }
      }
      const inputs: { category: EggStockCategory; quantity: number }[] = [
        { category: 'Unsorted', quantity: params.receipt.received.intactEggs },
        { category: 'Cracked', quantity: params.receipt.received.crackedEggs },
        { category: 'Damaged', quantity: params.receipt.received.damagedEggs },
      ];
      for (const { category, quantity } of inputs) {
        if (!quantity) continue;
        const key = category.toLowerCase();
        const id = `mv_${sortingId}_out_${key}`;
        tx.set(doc(db, ...ROOT(params.farmId), 'eggInventoryMovements', id), {
          id, farmId: params.farmId, movementType: 'sorting_out', category, balanceId: `bal_${sortingId}_${key}`,
          quantityDelta: -quantity, sourcePenId: params.receipt.penId,
          sourcePenNameSnapshot: params.receipt.penNameSnapshot, lotId: params.receipt.id,
          productionEntryId: params.receipt.productionEntryId, transferId: params.receipt.transferId,
          receiptId: params.receipt.id, sortingBatchId: sortingId, invoiceId: '', invoiceLineId: '',
          reference: '', transactionDate: params.transactionDate, reason: 'Reclassified by sorting',
          remarks: params.remarks.trim().slice(0, 500), actorUid: params.actor.uid,
          actorName: params.actor.displayName.slice(0, 150), createdAt: serverTimestamp(),
        } satisfies EggInventoryMovement);
      }
      const outputs: { category: EggStockCategory; quantity: number }[] = [
        ...Object.entries(params.outputsByGrade).map(([category, quantity]) => ({ category: category as EggStockCategory, quantity: Number(quantity || 0) })),
        { category: 'Cracked', quantity: params.crackedEggs },
        { category: 'Damaged', quantity: params.damagedEggs },
      ];
      for (const { category, quantity } of outputs) {
        if (!quantity) continue;
        const key = category.toLowerCase();
        const balanceId = `bal_${sortingId}_sorted_${key}`;
        const id = `mv_${sortingId}_in_${key}`;
        tx.set(doc(db, ...ROOT(params.farmId), 'eggInventoryBalances', balanceId), {
          id: balanceId, farmId: params.farmId, category, sourcePenId: params.receipt.penId,
          sourcePenNameSnapshot: params.receipt.penNameSnapshot, lotId: sortingId,
          balanceEggs: quantity, lastMovementId: id, updatedAt: serverTimestamp(),
        } satisfies EggInventoryBalance);
        tx.set(doc(db, ...ROOT(params.farmId), 'eggInventoryMovements', id), {
          id, farmId: params.farmId, movementType: 'sorting_in', category, balanceId,
          quantityDelta: quantity, sourcePenId: params.receipt.penId,
          sourcePenNameSnapshot: params.receipt.penNameSnapshot, lotId: sortingId,
          productionEntryId: params.receipt.productionEntryId, transferId: params.receipt.transferId,
          receiptId: params.receipt.id, sortingBatchId: sortingId, invoiceId: '', invoiceLineId: '',
          reference: '', transactionDate: params.transactionDate, reason: 'Sorted stock output',
          remarks: params.remarks.trim().slice(0, 500), actorUid: params.actor.uid,
          actorName: params.actor.displayName.slice(0, 150), createdAt: serverTimestamp(),
        } satisfies EggInventoryMovement);
      }
    });
  } catch (err) {
    if (err instanceof Error && /already been sorted|inventory changed|does not match|Sorting must reconcile/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `farms/${params.farmId}/eggSortingBatches/${sortingId}`);
  }
}

export async function recordEggInventoryMovement(params: {
  farmId: string;
  movementType: 'free_distribution' | 'breakage' | 'adjustment' | 'disposal';
  category: EggStockCategory;
  quantityDelta: number;
  balance?: EggInventoryBalance;
  sourcePenId: string;
  sourcePenName: string;
  transactionDate: string;
  reference: string;
  reason: string;
  remarks: string;
  actor: FarmMember;
}): Promise<void> {
  if (!Number.isInteger(params.quantityDelta) || params.quantityDelta === 0) throw new Error('Enter a non-zero whole-egg movement.');
  if (!params.reason.trim()) throw new Error('A reason is required for every inventory movement.');
  if (params.movementType !== 'adjustment' && params.quantityDelta > 0) throw new Error('This movement type can only reduce available stock.');
  const id = generateId('mv');
  const balanceId = params.balance?.id || `bal_${id}`;
  const balanceRef = doc(db, ...ROOT(params.farmId), 'eggInventoryBalances', balanceId);
  const movementRef = doc(db, ...ROOT(params.farmId), 'eggInventoryMovements', id);
  try {
    await runTransaction(db, async (tx) => {
      const balanceSnap = await tx.get(balanceRef);
      const current = balanceSnap.exists() ? balanceSnap.data() as EggInventoryBalance : null;
      if (!current && params.quantityDelta < 0) throw new Error('Select an existing stock lot before removing eggs.');
      if (current && current.category !== params.category) throw new Error('Selected stock lot category changed; refresh and try again.');
      const next = validateInventoryDelta(current?.balanceEggs || 0, params.quantityDelta, params.category);
      const lotId = current?.lotId || `adjust_${id}`;
      if (current) tx.update(balanceRef, { balanceEggs: next, lastMovementId: id, updatedAt: serverTimestamp() });
      else tx.set(balanceRef, {
        id: balanceId, farmId: params.farmId, category: params.category,
        sourcePenId: params.sourcePenId, sourcePenNameSnapshot: params.sourcePenName,
        lotId, balanceEggs: next, lastMovementId: id, updatedAt: serverTimestamp(),
      } satisfies EggInventoryBalance);
      tx.set(movementRef, {
        id, farmId: params.farmId, movementType: params.movementType,
        category: params.category, balanceId, quantityDelta: params.quantityDelta,
        sourcePenId: current?.sourcePenId || params.sourcePenId,
        sourcePenNameSnapshot: current?.sourcePenNameSnapshot || params.sourcePenName,
        lotId, productionEntryId: '', transferId: '', receiptId: '', sortingBatchId: '',
        invoiceId: '', invoiceLineId: '', reference: params.reference.trim().slice(0, 80),
        transactionDate: params.transactionDate, reason: params.reason.trim().slice(0, 160),
        remarks: params.remarks.trim().slice(0, 500), actorUid: params.actor.uid,
        actorName: params.actor.displayName.slice(0, 150), createdAt: serverTimestamp(),
      } satisfies EggInventoryMovement);
    });
  } catch (err) {
    if (err instanceof Error && /Select an existing|category changed|Insufficient|only reduce|reason is required|non-zero/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `farms/${params.farmId}/eggInventoryMovements/${id}`);
  }
}

export function aggregateEggBalances(balances: EggInventoryBalance[], organization: EggInventoryOrganization): Map<string, number> {
  const totals = new Map<string, number>();
  for (const balance of balances) {
    if (balance.balanceEggs <= 0) continue;
    const key = organization === 'pen_based' ? `${balance.sourcePenId}::${balance.category}` : balance.category;
    totals.set(key, (totals.get(key) || 0) + balance.balanceEggs);
  }
  return totals;
}
