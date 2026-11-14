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
import type { FarmPurchase, PoultryBatch, PurchaseCategory } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

export const PURCHASE_CATEGORIES: { value: PurchaseCategory; label: string }[] = [
  { value: 'medication', label: 'Medication & Drugs' },
  { value: 'vaccines_vet', label: 'Vaccines & Veterinary Care' },
  { value: 'supplements', label: 'Vitamins & Supplements' },
  { value: 'chicks_stock', label: 'Day-Old Chicks / Pullets' },
  { value: 'litter_bedding', label: 'Wood Shavings / Bedding' },
  { value: 'packaging', label: 'Egg Crates & Packaging' },
  { value: 'utilities_fuel', label: 'Fuel, Power & Water' },
  { value: 'equipment_repairs', label: 'Equipment & Pen Repairs' },
  { value: 'labor', label: 'Casual Labor / Services' },
  { value: 'other', label: 'Other Farm Expense' },
];

export const PURCHASE_CATEGORY_LABEL: Record<PurchaseCategory, string> = Object.fromEntries(
  PURCHASE_CATEGORIES.map((c) => [c.value, c.label])
) as Record<PurchaseCategory, string>;

const VALID_CATEGORIES = new Set<string>(PURCHASE_CATEGORIES.map((c) => c.value));

export async function createFarmPurchase(params: {
  farmId: string;
  transactionDate: string;
  category: PurchaseCategory;
  itemName: string;
  quantity: number;
  unit: string;
  unitPriceNgn: number;
  supplier: string;
  reference: string;
  batch?: PoultryBatch | null;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (!VALID_CATEGORIES.has(params.category)) {
    throw new Error('Invalid purchase category.');
  }
  const itemName = params.itemName.trim().slice(0, 120);
  const unit = params.unit.trim().slice(0, 40);
  if (!itemName) throw new Error('Item or expense name is required.');
  if (!unit) throw new Error('Unit of measure is required (e.g. bottle, vial, unit, litre).');
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new Error('Quantity must be greater than zero.');
  }
  if (!Number.isFinite(params.unitPriceNgn) || params.unitPriceNgn < 0) {
    throw new Error('Unit price must be zero or positive.');
  }

  const normalizedUnitPrice = Math.round(params.unitPriceNgn * 100) / 100;
  const totalCostNgn = Math.round(params.quantity * normalizedUnitPrice * 100) / 100;
  const batchId = params.batch?.id || '';
  const batchCodeSnapshot = params.batch?.batchCode || '';

  const id = generateId('fpur');
  const batchWrite = writeBatch(db);
  batchWrite.set(doc(db, 'farms', params.farmId, 'farmPurchases', id), {
    id,
    farmId: params.farmId,
    transactionDate: params.transactionDate,
    category: params.category,
    itemName,
    quantity: params.quantity,
    unit,
    unitPriceNgn: normalizedUnitPrice,
    totalCostNgn,
    supplier: params.supplier.trim().slice(0, 120),
    reference: params.reference.trim().slice(0, 80),
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
    entityType: 'farmPurchases',
    entityId: id,
    action: 'create',
    summary: `Recorded ${PURCHASE_CATEGORY_LABEL[params.category]} purchase: ${params.quantity} ${unit} of ${itemName} (₦${totalCostNgn.toLocaleString()})`,
    after: {
      transactionDate: params.transactionDate,
      category: params.category,
      itemName,
      quantity: params.quantity,
      unit,
      unitPriceNgn: normalizedUnitPrice,
      totalCostNgn,
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
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/farmPurchases/${id}`);
  }
}

export async function updateFarmPurchase(params: {
  farmId: string;
  purchase: FarmPurchase;
  transactionDate: string;
  category: PurchaseCategory;
  itemName: string;
  quantity: number;
  unit: string;
  unitPriceNgn: number;
  supplier: string;
  reference: string;
  batch?: PoultryBatch | null;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.purchase.isVoided) throw new Error('Voided purchase records cannot be edited.');
  if (!VALID_CATEGORIES.has(params.category)) {
    throw new Error('Invalid purchase category.');
  }
  const itemName = params.itemName.trim().slice(0, 120);
  const unit = params.unit.trim().slice(0, 40);
  if (!itemName) throw new Error('Item or expense name is required.');
  if (!unit) throw new Error('Unit of measure is required.');
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new Error('Quantity must be greater than zero.');
  }
  if (!Number.isFinite(params.unitPriceNgn) || params.unitPriceNgn < 0) {
    throw new Error('Unit price must be zero or positive.');
  }

  const normalizedUnitPrice = Math.round(params.unitPriceNgn * 100) / 100;
  const totalCostNgn = Math.round(params.quantity * normalizedUnitPrice * 100) / 100;
  const batchId = params.batch?.id || '';
  const batchCodeSnapshot = params.batch?.batchCode || '';

  const batchWrite = writeBatch(db);
  const updates = {
    transactionDate: params.transactionDate,
    category: params.category,
    itemName,
    quantity: params.quantity,
    unit,
    unitPriceNgn: normalizedUnitPrice,
    totalCostNgn,
    supplier: params.supplier.trim().slice(0, 120),
    reference: params.reference.trim().slice(0, 80),
    batchId,
    batchCodeSnapshot,
    remarks: params.remarks.trim().slice(0, 500),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };

  batchWrite.update(
    doc(db, 'farms', params.farmId, 'farmPurchases', params.purchase.id),
    updates
  );

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'farmPurchases',
    entityId: params.purchase.id,
    action: 'update',
    summary: `Updated farm purchase (${itemName} on ${params.transactionDate}, ₦${totalCostNgn.toLocaleString()})`,
    before: {
      itemName: params.purchase.itemName,
      category: params.purchase.category,
      totalCostNgn: params.purchase.totalCostNgn,
      batchCodeSnapshot: params.purchase.batchCodeSnapshot,
    },
    after: {
      itemName,
      category: params.category,
      totalCostNgn,
      batchCodeSnapshot,
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
      `farms/${params.farmId}/farmPurchases/${params.purchase.id}`
    );
  }
}

export async function voidFarmPurchase(params: {
  farmId: string;
  purchase: FarmPurchase;
  voidReason: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.purchase.isVoided) throw new Error('Purchase is already voided.');

  const batchWrite = writeBatch(db);
  batchWrite.update(doc(db, 'farms', params.farmId, 'farmPurchases', params.purchase.id), {
    isVoided: true,
    voidReason: reason.slice(0, 300),
    voidedBy: params.actorUid,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'farmPurchases',
    entityId: params.purchase.id,
    action: 'void',
    summary: `Voided purchase (${params.purchase.itemName}, ₦${params.purchase.totalCostNgn.toLocaleString()}): ${reason}`,
    before: { isVoided: false, totalCostNgn: params.purchase.totalCostNgn },
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
      `farms/${params.farmId}/farmPurchases/${params.purchase.id}`
    );
  }
}

export function subscribeFarmPurchases(
  farmId: string,
  onData: (purchases: FarmPurchase[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 500
) {
  const path = `farms/${farmId}/farmPurchases`;
  const q = query(
    collection(db, 'farms', farmId, 'farmPurchases'),
    orderBy('transactionDate', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FarmPurchase)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function fetchFarmPurchasesByDateRange(
  farmId: string,
  startDate: string,
  endDate: string
): Promise<FarmPurchase[]> {
  const path = `farms/${farmId}/farmPurchases`;
  const q = query(
    collection(db, 'farms', farmId, 'farmPurchases'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as FarmPurchase);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeFarmPurchasesByDateRange(
  farmId: string,
  startDate: string,
  endDate: string,
  onData: (purchases: FarmPurchase[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/farmPurchases`;
  const q = query(
    collection(db, 'farms', farmId, 'farmPurchases'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FarmPurchase)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}
