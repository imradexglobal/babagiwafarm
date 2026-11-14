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
import { generateId } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { EggSale, PaymentStatus, PoultryBatch, SalesUnit } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

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

  const batchWrite = writeBatch(db);
  batchWrite.update(doc(db, 'farms', params.farmId, 'eggSales', params.sale.id), {
    isVoided: true,
    voidReason: reason.slice(0, 300),
    voidedBy: params.actorUid,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });

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
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/eggSales/${params.sale.id}`);
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

