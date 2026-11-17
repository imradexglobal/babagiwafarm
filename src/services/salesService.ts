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
import { generateId } from '../domain/calculations.ts';
import { validateInventoryDelta } from '../domain/eggStore.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { EggSale, PaymentStatus, PoultryBatch, SalesUnit } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';
import type { EggInventoryBalance, EggInventoryMovement, EggStoreSettings } from '../types/eggStore.ts';

export async function createEggSale(params: {
  farmId: string;
  transactionDate: string;
  transactionTime: string;
  customerName: string;
  eggCategory: string;
  salesUnit: SalesUnit;
  quantity: number;
  unitPriceNgn: number;
  canOverridePrice: boolean;
  overrideReason: string;
  paymentStatus: PaymentStatus;
  receivedAmountNgn?: number;
  batch?: PoultryBatch | null;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new Error('Sale quantity must be greater than zero.');
  }
  if (!Number.isFinite(params.unitPriceNgn) || params.unitPriceNgn < 0) {
    throw new Error('Unit price must be zero or positive.');
  }

  const suggestedUnitPriceNgn = params.salesUnit.currentPriceNgn;
  const normalizedUnitPrice = Math.round(params.unitPriceNgn * 100) / 100;
  const priceOverridden = Math.abs(normalizedUnitPrice - suggestedUnitPriceNgn) > 0.001;

  if (priceOverridden && !params.canOverridePrice) {
    throw new Error('You do not have permission to override the configured unit price.');
  }
  if (priceOverridden && !params.overrideReason.trim()) {
    throw new Error('Please provide a reason for overriding the configured unit price.');
  }

  const totalEggsEquivalent = Math.round(params.quantity * params.salesUnit.eggCountPerUnit * 100) / 100;
  const totalAmountNgn = Math.round(params.quantity * normalizedUnitPrice * 100) / 100;
  const receivedAmountNgn = Math.min(totalAmountNgn, Math.max(0, params.receivedAmountNgn ?? (params.paymentStatus === 'paid' ? totalAmountNgn : 0)));
  const batchId = params.batch?.id || '';
  const batchCodeSnapshot = params.batch?.batchCode || '';

  const id = generateId('sale');
  const batchWrite = writeBatch(db);
  batchWrite.set(doc(db, 'farms', params.farmId, 'eggSales', id), {
    id,
    farmId: params.farmId,
    transactionDate: params.transactionDate,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    customerName: params.customerName.trim().slice(0, 120),
    eggCategory: (params.eggCategory.trim() || 'Standard Brown').slice(0, 80),
    salesUnitId: params.salesUnit.id,
    unitNameSnapshot: params.salesUnit.name,
    eggsPerUnitSnapshot: params.salesUnit.eggCountPerUnit,
    quantity: params.quantity,
    totalEggsEquivalent,
    suggestedUnitPriceNgn,
    unitPriceNgn: normalizedUnitPrice,
    priceOverridden,
    overrideReason: priceOverridden ? params.overrideReason.trim().slice(0, 300) : '',
    totalAmountNgn,
    paymentStatus: params.paymentStatus,
    receivedAmountNgn,
    balanceDueNgn: Math.round((totalAmountNgn - receivedAmountNgn) * 100) / 100,
    batchId,
    batchCodeSnapshot,
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
    entityType: 'eggSale',
    entityId: id,
    action: priceOverridden ? 'price_override' : 'create',
    summary: priceOverridden
      ? `Egg sale (${params.quantity} × ${params.salesUnit.name}) with price override ₦${suggestedUnitPriceNgn} → ₦${normalizedUnitPrice}: ${params.overrideReason}`
      : `Recorded egg sale: ${params.quantity} × ${params.salesUnit.name} = ₦${totalAmountNgn.toLocaleString()}`,
    after: {
      transactionDate: params.transactionDate,
      quantity: params.quantity,
      unitName: params.salesUnit.name,
      suggestedUnitPriceNgn,
      unitPriceNgn: normalizedUnitPrice,
      totalAmountNgn,
      priceOverridden,
      batchCodeSnapshot,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/eggSales/${id}`);
  }
}

export async function updateEggSale(params: {
  farmId: string;
  sale: EggSale;
  transactionDate: string;
  transactionTime: string;
  customerName: string;
  eggCategory: string;
  quantity: number;
  unitPriceNgn: number;
  canOverridePrice: boolean;
  overrideReason: string;
  paymentStatus: PaymentStatus;
  receivedAmountNgn?: number;
  batch?: PoultryBatch | null;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.sale.isVoided) throw new Error('Voided sale records cannot be edited.');
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new Error('Quantity must be greater than zero.');
  }
  const normalizedPrice = Math.round(params.unitPriceNgn * 100) / 100;
  const priceChanged = Math.abs(normalizedPrice - params.sale.unitPriceNgn) > 0.001;
  if (priceChanged && !params.canOverridePrice) {
    throw new Error('You do not have permission to change the unit price on a sale.');
  }
  const priceOverridden =
    params.sale.priceOverridden || Math.abs(normalizedPrice - params.sale.suggestedUnitPriceNgn) > 0.001;
  if (priceChanged && !params.overrideReason.trim()) {
    throw new Error('Please provide a reason for changing the unit price.');
  }

  const totalEggsEquivalent = Math.round(params.quantity * params.sale.eggsPerUnitSnapshot * 100) / 100;
  const totalAmountNgn = Math.round(params.quantity * normalizedPrice * 100) / 100;
  const receivedAmountNgn = Math.min(totalAmountNgn, Math.max(0, params.receivedAmountNgn ?? (params.paymentStatus === 'paid'
    ? totalAmountNgn
    : params.paymentStatus === 'pending'
      ? 0
      : Math.min(params.sale.receivedAmountNgn || 0, totalAmountNgn))));
  const batchId = params.batch?.id || '';
  const batchCodeSnapshot = params.batch?.batchCode || '';

  const batchWrite = writeBatch(db);
  const updates = {
    transactionDate: params.transactionDate,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    customerName: params.customerName.trim().slice(0, 120),
    eggCategory: (params.eggCategory.trim() || 'Standard Brown').slice(0, 80),
    quantity: params.quantity,
    totalEggsEquivalent,
    unitPriceNgn: normalizedPrice,
    priceOverridden,
    overrideReason: priceChanged
      ? params.overrideReason.trim().slice(0, 300)
      : params.sale.overrideReason,
    totalAmountNgn,
    paymentStatus: params.paymentStatus,
    receivedAmountNgn,
    balanceDueNgn: Math.round((totalAmountNgn - receivedAmountNgn) * 100) / 100,
    batchId,
    batchCodeSnapshot,
    remarks: params.remarks.trim().slice(0, 500),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };

  batchWrite.update(doc(db, 'farms', params.farmId, 'eggSales', params.sale.id), updates);

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'eggSale',
    entityId: params.sale.id,
    action: priceChanged ? 'price_override' : 'update',
    summary: `Updated egg sale on ${params.transactionDate} (${params.quantity} × ${params.sale.unitNameSnapshot})`,
    before: {
      quantity: params.sale.quantity,
      unitPriceNgn: params.sale.unitPriceNgn,
      totalAmountNgn: params.sale.totalAmountNgn,
      paymentStatus: params.sale.paymentStatus,
      batchCodeSnapshot: params.sale.batchCodeSnapshot || '',
    },
    after: {
      quantity: updates.quantity,
      unitPriceNgn: updates.unitPriceNgn,
      totalAmountNgn: updates.totalAmountNgn,
      paymentStatus: updates.paymentStatus,
      batchCodeSnapshot,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  const linkedSaleMovement = (await getDocs(query(
    collection(db, 'farms', params.farmId, 'eggInventoryMovements'),
    where('reference', '==', params.sale.id)
  ))).docs.map((d) => d.data() as EggInventoryMovement).find((movement) => movement.movementType === 'sale' && movement.quantityDelta < 0);
  if (linkedSaleMovement) {
    if (params.eggCategory !== params.sale.eggCategory) throw new Error('The egg grade cannot be changed on a true-inventory sale. Void and recreate the sale.');
    const saleRef = doc(db, 'farms', params.farmId, 'eggSales', params.sale.id);
    const balanceRef = doc(db, 'farms', params.farmId, 'eggInventoryBalances', linkedSaleMovement.balanceId);
    const settingsRef = doc(db, 'farms', params.farmId, 'eggStoreSettings', 'current');
    const movementId = generateId('mv');
    const movementRef = doc(db, 'farms', params.farmId, 'eggInventoryMovements', movementId);
    const previousEggs = params.sale.totalEggsEquivalent ?? params.sale.quantity * params.sale.eggsPerUnitSnapshot;
    const delta = Math.round((previousEggs - totalEggsEquivalent) * 100) / 100;
    try {
      await runTransaction(db, async (tx) => {
        const [saleSnap, balanceSnap, settingsSnap] = await Promise.all([tx.get(saleRef), tx.get(balanceRef), tx.get(settingsRef)]);
        if (!saleSnap.exists() || !balanceSnap.exists()) throw new Error('The sale or its stock lot no longer exists.');
        if (!settingsSnap.exists() || (settingsSnap.data() as EggStoreSettings).salesMode !== 'true_inventory') throw new Error('True Egg Sales mode is no longer enabled.');
        const currentSale = saleSnap.data() as EggSale;
        const balance = balanceSnap.data() as EggInventoryBalance;
        if ((currentSale.totalEggsEquivalent ?? currentSale.quantity * currentSale.eggsPerUnitSnapshot) !== previousEggs) throw new Error('This sale changed elsewhere. Refresh and retry.');
        if (delta !== 0) validateInventoryDelta(balance.balanceEggs, delta, balance.category);
        tx.update(saleRef, updates);
        if (delta !== 0) {
          tx.update(balanceRef, { balanceEggs: balance.balanceEggs + delta, lastMovementId: movementId, updatedAt: serverTimestamp() });
          tx.set(movementRef, { ...linkedSaleMovement, id: movementId, movementType: 'adjustment', quantityDelta: delta, reference: params.sale.id, transactionDate: params.transactionDate, reason: 'Sale edited', remarks: `Sale quantity adjusted from ${previousEggs} to ${totalEggsEquivalent} eggs.`, actorUid: params.actorUid, actorName: params.actorName.slice(0, 150), createdAt: serverTimestamp() });
        }
        tx.set(audit.ref, audit.data);
      });
      return;
    } catch (err) {
      if (err instanceof Error && /stock|True Egg|changed elsewhere|grade|Insufficient/.test(err.message)) throw err;
      handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggSales/${params.sale.id}`);
    }
  }

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggSales/${params.sale.id}`);
  }
}

export async function voidEggSale(params: {
  farmId: string;
  sale: EggSale;
  voidReason: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.sale.isVoided) throw new Error('Sale is already voided.');

  // Check if there are true-inventory movements associated with this sale
  const movementsQ = query(
    collection(db, 'farms', params.farmId, 'eggInventoryMovements'),
    where('reference', '==', params.sale.id)
  );
  const movementsSnap = await getDocs(movementsQ);
  const movementsToReverse = movementsSnap.docs
    .map((d) => d.data() as EggInventoryMovement)
    .filter((m) => m.movementType === 'sale' && m.quantityDelta < 0);

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'eggSale',
    entityId: params.sale.id,
    action: 'void',
    summary: `Voided egg sale (₦${params.sale.totalAmountNgn.toLocaleString()} on ${params.sale.transactionDate}): ${reason}`,
    before: { isVoided: false, totalAmountNgn: params.sale.totalAmountNgn },
    after: { isVoided: true, voidReason: reason },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });

  if (movementsToReverse.length > 0) {
    try {
      await runTransaction(db, async (tx) => {
        const balanceUpdates: { ref: any; nextBalance: number; reversalMvRef: any; reversalMvData: any }[] = [];

        for (const mv of movementsToReverse) {
          const balRef = doc(db, 'farms', params.farmId, 'eggInventoryBalances', mv.balanceId);
          const balSnap = await tx.get(balRef);
          if (balSnap.exists()) {
            const bal = balSnap.data() as EggInventoryBalance;
            const restoredEggs = bal.balanceEggs + Math.abs(mv.quantityDelta);
            const reversalMvId = generateId('mv');
            const reversalMvRef = doc(db, 'farms', params.farmId, 'eggInventoryMovements', reversalMvId);
            balanceUpdates.push({
              ref: balRef,
              nextBalance: restoredEggs,
              reversalMvRef,
              reversalMvData: {
                id: reversalMvId,
                farmId: params.farmId,
                movementType: 'reversal',
                category: bal.category,
                balanceId: bal.id,
                quantityDelta: Math.abs(mv.quantityDelta),
                sourcePenId: bal.sourcePenId,
                sourcePenNameSnapshot: bal.sourcePenNameSnapshot,
                lotId: bal.lotId,
                productionEntryId: '',
                transferId: '',
                receiptId: '',
                sortingBatchId: '',
                invoiceId: '',
                invoiceLineId: '',
                reference: params.sale.id,
                transactionDate: params.sale.transactionDate,
                reason: 'Voided egg sale',
                remarks: reason.slice(0, 500),
                actorUid: params.actorUid,
                actorName: params.actorName.slice(0, 150),
                createdAt: serverTimestamp(),
              },
            });
          }
        }

        for (const u of balanceUpdates) {
          tx.update(u.ref, { balanceEggs: u.nextBalance, lastMovementId: u.reversalMvData.id, updatedAt: serverTimestamp() });
          tx.set(u.reversalMvRef, u.reversalMvData);
        }

        tx.update(doc(db, 'farms', params.farmId, 'eggSales', params.sale.id), {
          isVoided: true,
          voidReason: reason.slice(0, 300),
          voidedBy: params.actorUid,
          updatedBy: params.actorUid,
          updatedAt: serverTimestamp(),
        });

        tx.set(audit.ref, audit.data);
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggSales/${params.sale.id}`);
    }
  } else {
    const batchWrite = writeBatch(db);
    batchWrite.update(doc(db, 'farms', params.farmId, 'eggSales', params.sale.id), {
      isVoided: true,
      voidReason: reason.slice(0, 300),
      voidedBy: params.actorUid,
      updatedBy: params.actorUid,
      updatedAt: serverTimestamp(),
    });
    batchWrite.set(audit.ref, audit.data);

    try {
      await batchWrite.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggSales/${params.sale.id}`);
    }
  }
}

export function subscribeEggSales(
  farmId: string,
  onData: (sales: EggSale[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 500
) {
  const path = `farms/${farmId}/eggSales`;
  const q = query(
    collection(db, 'farms', farmId, 'eggSales'),
    orderBy('transactionDate', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as EggSale)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function fetchEggSalesByDateRange(
  farmId: string,
  startDate: string,
  endDate: string
): Promise<EggSale[]> {
  const path = `farms/${farmId}/eggSales`;
  const q = query(
    collection(db, 'farms', farmId, 'eggSales'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as EggSale);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeEggSalesByDateRange(
  farmId: string,
  startDate: string,
  endDate: string,
  onData: (sales: EggSale[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/eggSales`;
  const q = query(
    collection(db, 'farms', farmId, 'eggSales'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as EggSale)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}



/** Posts a sale and its stock deduction atomically for True Egg Sales mode. */
export async function createTrueInventoryEggSale(params: {
  farmId: string;
  transactionDate: string;
  transactionTime: string;
  customerName: string;
  eggCategory: string;
  salesUnit: SalesUnit;
  quantity: number;
  unitPriceNgn: number;
  canOverridePrice: boolean;
  overrideReason: string;
  paymentStatus: PaymentStatus;
  receivedAmountNgn?: number;
  batch?: PoultryBatch | null;
  remarks: string;
  actorUid: string;
  actorName: string;
  settings: EggStoreSettings;
  balance: EggInventoryBalance;
}): Promise<string> {
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) throw new Error('Sale quantity must be greater than zero.');
  if (!Number.isFinite(params.unitPriceNgn) || params.unitPriceNgn < 0) throw new Error('Unit price must be zero or positive.');
  if (params.settings.salesMode !== 'true_inventory') throw new Error('True Egg Sales mode is not enabled. Refresh and try again.');
  const suggestedUnitPriceNgn = params.salesUnit.currentPriceNgn;
  const normalizedUnitPrice = Math.round(params.unitPriceNgn * 100) / 100;
  const priceOverridden = Math.abs(normalizedUnitPrice - suggestedUnitPriceNgn) > 0.001;
  if (priceOverridden && !params.canOverridePrice) throw new Error('You do not have permission to override the configured unit price.');
  if (priceOverridden && !params.overrideReason.trim()) throw new Error('Please provide a reason for overriding the configured unit price.');
  const totalEggsEquivalent = Math.round(params.quantity * params.salesUnit.eggCountPerUnit * 100) / 100;
  if (!Number.isInteger(totalEggsEquivalent)) throw new Error('This selling quantity does not convert to a whole number of eggs.');
  if (params.balance.category !== params.eggCategory) throw new Error(`Select the ${params.balance.category} stock lot for this sale.`);
  const totalAmountNgn = Math.round(params.quantity * normalizedUnitPrice * 100) / 100;
  const receivedAmountNgn = params.paymentStatus === 'paid' ? totalAmountNgn : 0;
  const id = generateId('sale');
  const movementId = generateId('mv');
  const saleRef = doc(db, 'farms', params.farmId, 'eggSales', id);
  const settingsRef = doc(db, 'farms', params.farmId, 'eggStoreSettings', 'current');
  const balanceRef = doc(db, 'farms', params.farmId, 'eggInventoryBalances', params.balance.id);
  const movementRef = doc(db, 'farms', params.farmId, 'eggInventoryMovements', movementId);
  const batchId = params.batch?.id || '';
  const batchCodeSnapshot = params.batch?.batchCode || '';
  const saleData = {
    id, farmId: params.farmId, transactionDate: params.transactionDate,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    customerName: params.customerName.trim().slice(0, 120),
    eggCategory: params.eggCategory.trim().slice(0, 80), salesUnitId: params.salesUnit.id,
    unitNameSnapshot: params.salesUnit.name, eggsPerUnitSnapshot: params.salesUnit.eggCountPerUnit,
    quantity: params.quantity, totalEggsEquivalent, suggestedUnitPriceNgn,
    unitPriceNgn: normalizedUnitPrice, priceOverridden,
    overrideReason: priceOverridden ? params.overrideReason.trim().slice(0, 300) : '',
    totalAmountNgn, paymentStatus: params.paymentStatus, receivedAmountNgn,
    balanceDueNgn: Math.round((totalAmountNgn - receivedAmountNgn) * 100) / 100, batchId, batchCodeSnapshot,
    remarks: params.remarks.trim().slice(0, 500), isVoided: false, voidReason: '', voidedBy: '',
    createdBy: params.actorUid, createdByName: params.actorName.slice(0, 150),
    updatedBy: params.actorUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  const audit = buildAuditLogEntry({
    farmId: params.farmId, entityType: 'eggSale', entityId: id,
    action: priceOverridden ? 'price_override' : 'create',
    summary: `Recorded True-mode egg sale: ${params.quantity} × ${params.salesUnit.name} = ₦${totalAmountNgn.toLocaleString()}`,
    after: { transactionDate: params.transactionDate, quantity: params.quantity, unitName: params.salesUnit.name, totalEggsEquivalent, totalAmountNgn, batchCodeSnapshot },
    actorUid: params.actorUid, actorName: params.actorName,
  });
  try {
    await runTransaction(db, async (tx) => {
      const [settingsSnap, balanceSnap] = await Promise.all([tx.get(settingsRef), tx.get(balanceRef)]);
      if (!settingsSnap.exists() || (settingsSnap.data() as EggStoreSettings).salesMode !== 'true_inventory') throw new Error('True Egg Sales mode is no longer enabled. Refresh and try again.');
      if (!balanceSnap.exists()) throw new Error('The selected stock lot no longer exists. Refresh and try again.');
      const current = balanceSnap.data() as EggInventoryBalance;
      if (current.category !== params.eggCategory) throw new Error('The selected grade no longer matches this stock lot. Refresh and try again.');
      const next = validateInventoryDelta(current.balanceEggs, -totalEggsEquivalent, current.category);
      tx.update(balanceRef, { balanceEggs: next, lastMovementId: movementId, updatedAt: serverTimestamp() });
      tx.set(movementRef, {
        id: movementId, farmId: params.farmId, movementType: 'sale', category: current.category,
        balanceId: current.id, quantityDelta: -totalEggsEquivalent, sourcePenId: current.sourcePenId,
        sourcePenNameSnapshot: current.sourcePenNameSnapshot, lotId: current.lotId,
        productionEntryId: '', transferId: '', receiptId: '', sortingBatchId: '', invoiceId: '', invoiceLineId: '',
        reference: id, transactionDate: params.transactionDate, reason: 'Egg sale',
        remarks: params.remarks.trim().slice(0, 500), actorUid: params.actorUid,
        actorName: params.actorName.slice(0, 150), createdAt: serverTimestamp(),
      });
      tx.set(saleRef, saleData);
      tx.set(audit.ref, audit.data);
    });
    return id;
  } catch (err) {
    if (err instanceof Error && /Insufficient|True Egg Sales|stock lot|grade|whole number/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/eggSales/${id}`);
  }
}
