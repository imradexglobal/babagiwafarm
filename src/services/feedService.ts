import {
  collection,
  doc,
  getDoc,
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
import {
  computeConsumptionCostNgn,
  convertFeedToGrams,
  findQualifyingPurchaseForConsumption,
  formatGramsToKgAndBags,
  generateId,
} from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type {
  FeedConsumption,
  FeedItem,
  FeedPurchase,
  FeedStock,
  FeedUnit,
  PoultryBatch,
} from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

export async function createFeedPurchase(params: {
  farmId: string;
  transactionDate: string;
  feedItem: FeedItem;
  enteredQuantity: number;
  enteredUnit: FeedUnit;
  bagWeightKg: number;
  unitPurchasePriceNgn: number;
  supplier: string;
  reference: string;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (params.feedItem.status !== 'active') {
    throw new Error('Selected feed item is inactive.');
  }
  if (!Number.isFinite(params.unitPurchasePriceNgn) || params.unitPurchasePriceNgn < 0) {
    throw new Error('Unit purchase price must be zero or positive.');
  }

  const standardizedGrams = convertFeedToGrams(
    params.enteredQuantity,
    params.enteredUnit,
    params.bagWeightKg
  );
  const totalCostNgn = Math.round(params.enteredQuantity * params.unitPurchasePriceNgn * 100) / 100;
  const unitCostPerGramNgn = totalCostNgn / standardizedGrams;

  const id = generateId('pur');
  const purchaseRef = doc(db, 'farms', params.farmId, 'feedPurchases', id);
  const stockRef = doc(db, 'farms', params.farmId, 'feedStock', params.feedItem.id);

  try {
    await runTransaction(db, async (tx) => {
      const stockSnap = await tx.get(stockRef);
      const currentBalance = stockSnap.exists() ? (stockSnap.data() as FeedStock).balanceGrams : 0;
      const currentLastDate = stockSnap.exists() ? (stockSnap.data() as FeedStock).lastPurchaseDate : '';
      const currentLastCost = stockSnap.exists()
        ? (stockSnap.data() as FeedStock).lastUnitCostPerGramNgn
        : 0;

      const isNewerOrSame = !currentLastDate || params.transactionDate >= currentLastDate;

      tx.set(purchaseRef, {
        id,
        farmId: params.farmId,
        transactionDate: params.transactionDate,
        feedItemId: params.feedItem.id,
        feedTypeSnapshot: params.feedItem.feedType,
        brandSnapshot: params.feedItem.brand,
        enteredQuantity: params.enteredQuantity,
        enteredUnit: params.enteredUnit,
        bagWeightKgSnapshot: params.bagWeightKg,
        standardizedGrams,
        unitPurchasePriceNgn: Math.round(params.unitPurchasePriceNgn * 100) / 100,
        totalCostNgn,
        unitCostPerGramNgn,
        supplier: params.supplier.trim().slice(0, 120),
        reference: params.reference.trim().slice(0, 80),
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

      const nextStock = {
        feedItemId: params.feedItem.id,
        farmId: params.farmId,
        feedType: params.feedItem.feedType,
        brand: params.feedItem.brand,
        balanceGrams: Math.round((currentBalance + standardizedGrams) * 1000) / 1000,
        lastPurchaseDate: isNewerOrSame ? params.transactionDate : currentLastDate,
        lastUnitCostPerGramNgn: isNewerOrSame ? unitCostPerGramNgn : currentLastCost,
        updatedAt: serverTimestamp(),
      };

      if (stockSnap.exists()) {
        tx.update(stockRef, {
          feedType: nextStock.feedType,
          brand: nextStock.brand,
          balanceGrams: nextStock.balanceGrams,
          lastPurchaseDate: nextStock.lastPurchaseDate,
          lastUnitCostPerGramNgn: nextStock.lastUnitCostPerGramNgn,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(stockRef, nextStock);
      }

      const audit = buildAuditLogEntry({
        farmId: params.farmId,
        entityType: 'feedPurchase',
        entityId: id,
        action: 'create',
        summary: `Purchased ${params.enteredQuantity} ${params.enteredUnit} of ${params.feedItem.feedType} (${params.feedItem.brand}) for ₦${totalCostNgn.toLocaleString()}`,
        after: {
          transactionDate: params.transactionDate,
          feedType: params.feedItem.feedType,
          standardizedGrams,
          totalCostNgn,
        },
        actorUid: params.actorUid,
        actorName: params.actorName,
      });
      tx.set(audit.ref, audit.data);
    });
    return id;
  } catch (err) {
    if (err instanceof Error && !err.message.toLowerCase().includes('permission')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/feedPurchases/${id}`);
  }
}

export async function voidFeedPurchase(params: {
  farmId: string;
  purchase: FeedPurchase;
  voidReason: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.purchase.isVoided) throw new Error('Purchase is already voided.');

  const purchaseRef = doc(db, 'farms', params.farmId, 'feedPurchases', params.purchase.id);
  const stockRef = doc(db, 'farms', params.farmId, 'feedStock', params.purchase.feedItemId);

  try {
    await runTransaction(db, async (tx) => {
      const [purSnap, stockSnap] = await Promise.all([tx.get(purchaseRef), tx.get(stockRef)]);
      if (!purSnap.exists()) throw new Error('Purchase record not found.');
      if (!stockSnap.exists()) throw new Error('Feed stock balance record not found.');

      const stock = stockSnap.data() as FeedStock;
      if (stock.balanceGrams < params.purchase.standardizedGrams) {
        const avail = formatGramsToKgAndBags(stock.balanceGrams);
        const req = formatGramsToKgAndBags(params.purchase.standardizedGrams);
        throw new Error(
          `Cannot void this purchase because part of the stock has already been consumed (Available: ${avail.kgText}, Purchase quantity: ${req.kgText}).`
        );
      }

      tx.update(purchaseRef, {
        isVoided: true,
        voidReason: reason.slice(0, 300),
        voidedBy: params.actorUid,
        updatedBy: params.actorUid,
        updatedAt: serverTimestamp(),
      });

      tx.update(stockRef, {
        balanceGrams: Math.round((stock.balanceGrams - params.purchase.standardizedGrams) * 1000) / 1000,
        updatedAt: serverTimestamp(),
      });

      const audit = buildAuditLogEntry({
        farmId: params.farmId,
        entityType: 'feedPurchase',
        entityId: params.purchase.id,
        action: 'void',
        summary: `Voided feed purchase (${params.purchase.feedTypeSnapshot}): ${reason}`,
        before: { isVoided: false, standardizedGrams: params.purchase.standardizedGrams },
        after: { isVoided: true, voidReason: reason },
        actorUid: params.actorUid,
        actorName: params.actorName,
      });
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    if (err instanceof Error && !err.message.toLowerCase().includes('permission')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `farms/${params.farmId}/feedPurchases/${params.purchase.id}`);
  }
}

export async function createFeedConsumption(params: {
  farmId: string;
  transactionDate: string;
  transactionTime: string;
  batch: PoultryBatch;
  feedItem: FeedItem;
  enteredQuantity: number;
  enteredUnit: FeedUnit;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (params.batch.status !== 'active') {
    throw new Error(`Batch "${params.batch.batchCode}" is inactive.`);
  }
  if (params.feedItem.status !== 'active') {
    throw new Error('Selected feed item is inactive.');
  }

  const standardizedGrams = convertFeedToGrams(
    params.enteredQuantity,
    params.enteredUnit,
    params.feedItem.defaultBagWeightKg
  );

  // Fetch non-voided purchases for this feed item to enforce strict "latest purchase <= consumptionDate" costing
  const purchasesQuery = query(
    collection(db, 'farms', params.farmId, 'feedPurchases'),
    where('feedItemId', '==', params.feedItem.id)
  );
  let purchases: FeedPurchase[] = [];
  try {
    const snap = await getDocs(purchasesQuery);
    purchases = snap.docs.map((d) => d.data() as FeedPurchase);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `farms/${params.farmId}/feedPurchases`);
  }

  const stockRef = doc(db, 'farms', params.farmId, 'feedStock', params.feedItem.id);
  let costSource = findQualifyingPurchaseForConsumption(
    purchases,
    params.feedItem.id,
    params.transactionDate
  );


  if (!costSource) {
    try {
      const stockSnap = await getDoc(stockRef);
      if (stockSnap.exists() && (stockSnap.data() as FeedStock).lastUnitCostPerGramNgn > 0) {
        const stock = stockSnap.data() as FeedStock;
        costSource = {
          purchaseId: '',
          purchaseDate: stock.lastPurchaseDate || params.transactionDate,
          unitCostPerGramNgn: stock.lastUnitCostPerGramNgn,
        };
      }
    } catch {
      // Continue to fallback
    }
  }

  if (!costSource) {
    const anyPurchase = purchases
      .filter((p) => !p.isVoided && p.feedItemId === params.feedItem.id && p.unitCostPerGramNgn > 0)
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))[0];
    if (anyPurchase) {
      costSource = {
        purchaseId: anyPurchase.id,
        purchaseDate: anyPurchase.transactionDate,
        unitCostPerGramNgn: anyPurchase.unitCostPerGramNgn,
      };
    }
  }

  if (!costSource) {
    throw new Error(
      `No cost data found for "${params.feedItem.feedType} (${params.feedItem.brand})". Record at least one feed purchase with a unit price first.`
    );
  }

  const totalCostNgn = computeConsumptionCostNgn(standardizedGrams, costSource.unitCostPerGramNgn);

  const id = generateId('cons');
  const consRef = doc(db, 'farms', params.farmId, 'feedConsumption', id);

  try {
    await runTransaction(db, async (tx) => {
      const stockSnap = await tx.get(stockRef);
      const currentBalance = stockSnap.exists() ? (stockSnap.data() as FeedStock).balanceGrams : 0;

      if (currentBalance < standardizedGrams) {
        const avail = formatGramsToKgAndBags(currentBalance, params.feedItem.defaultBagWeightKg);
        const req = formatGramsToKgAndBags(standardizedGrams, params.feedItem.defaultBagWeightKg);
        throw new Error(
          `Insufficient stock for ${params.feedItem.feedType} (${params.feedItem.brand}). Available: ${avail.kgText} (${avail.bagsText}); Requested: ${req.kgText} (${req.bagsText}).`
        );
      }

      tx.update(stockRef, {
        balanceGrams: Math.round((currentBalance - standardizedGrams) * 1000) / 1000,
        updatedAt: serverTimestamp(),
      });

      tx.set(consRef, {
        id,
        farmId: params.farmId,
        transactionDate: params.transactionDate,
        transactionTime: params.transactionTime.trim().slice(0, 5),
        batchId: params.batch.id,
        batchCodeSnapshot: params.batch.batchCode,
        penId: params.batch.penId,
        penNameSnapshot: params.batch.penNameSnapshot,
        feedItemId: params.feedItem.id,
        feedTypeSnapshot: params.feedItem.feedType,
        brandSnapshot: params.feedItem.brand,
        enteredQuantity: params.enteredQuantity,
        enteredUnit: params.enteredUnit,
        bagWeightKgSnapshot: params.feedItem.defaultBagWeightKg,
        standardizedGrams,
        costSourcePurchaseId: costSource.purchaseId,
        costSourcePurchaseDate: costSource.purchaseDate,
        unitCostPerGramNgn: costSource.unitCostPerGramNgn,
        totalCostNgn,
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
        entityType: 'feedConsumption',
        entityId: id,
        action: 'create',
        summary: `Issued ${params.enteredQuantity} ${params.enteredUnit} (${params.feedItem.feedType}) to ${params.batch.batchCode}; cost snapshot ₦${totalCostNgn.toLocaleString()}`,
        after: {
          transactionDate: params.transactionDate,
          batchCode: params.batch.batchCode,
          standardizedGrams,
          costSourcePurchaseId: costSource.purchaseId,
          totalCostNgn,
        },
        actorUid: params.actorUid,
        actorName: params.actorName,
      });
      tx.set(audit.ref, audit.data);
    });
    return id;
  } catch (err) {
    if (err instanceof Error && !err.message.toLowerCase().includes('permission')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/feedConsumption/${id}`);
  }
}

export async function updateFeedConsumptionMeta(params: {
  farmId: string;
  consumption: FeedConsumption;
  transactionDate: string;
  transactionTime: string;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.consumption.isVoided) {
    throw new Error('Voided feed consumption records cannot be edited.');
  }
  const batchWrite = writeBatch(db);
  const updates = {
    transactionDate: params.transactionDate,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    remarks: params.remarks.trim().slice(0, 500),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };
  batchWrite.update(doc(db, 'farms', params.farmId, 'feedConsumption', params.consumption.id), updates);

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'feedConsumption',
    entityId: params.consumption.id,
    action: 'update',
    summary: `Edited feed consumption notes/date for ${params.consumption.batchCodeSnapshot} (cost snapshot preserved)`,
    before: {
      transactionDate: params.consumption.transactionDate,
      transactionTime: params.consumption.transactionTime,
      remarks: params.consumption.remarks,
    },
    after: {
      transactionDate: updates.transactionDate,
      transactionTime: updates.transactionTime,
      remarks: updates.remarks,
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
      `farms/${params.farmId}/feedConsumption/${params.consumption.id}`
    );
  }
}

export async function voidFeedConsumption(params: {
  farmId: string;
  consumption: FeedConsumption;
  voidReason: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.consumption.isVoided) throw new Error('Record is already voided.');

  const consRef = doc(db, 'farms', params.farmId, 'feedConsumption', params.consumption.id);
  const stockRef = doc(db, 'farms', params.farmId, 'feedStock', params.consumption.feedItemId);

  try {
    await runTransaction(db, async (tx) => {
      const [consSnap, stockSnap] = await Promise.all([tx.get(consRef), tx.get(stockRef)]);
      if (!consSnap.exists()) throw new Error('Consumption record not found.');
      const currentBalance = stockSnap.exists() ? (stockSnap.data() as FeedStock).balanceGrams : 0;

      tx.update(consRef, {
        isVoided: true,
        voidReason: reason.slice(0, 300),
        voidedBy: params.actorUid,
        updatedBy: params.actorUid,
        updatedAt: serverTimestamp(),
      });

      if (stockSnap.exists()) {
        tx.update(stockRef, {
          balanceGrams: Math.round((currentBalance + params.consumption.standardizedGrams) * 1000) / 1000,
          updatedAt: serverTimestamp(),
        });
      }

      const audit = buildAuditLogEntry({
        farmId: params.farmId,
        entityType: 'feedConsumption',
        entityId: params.consumption.id,
        action: 'void',
        summary: `Voided feed consumption (${params.consumption.feedTypeSnapshot}) and restored stock: ${reason}`,
        before: { isVoided: false, standardizedGrams: params.consumption.standardizedGrams },
        after: { isVoided: true, voidReason: reason },
        actorUid: params.actorUid,
        actorName: params.actorName,
      });
      tx.set(audit.ref, audit.data);
    });
  } catch (err) {
    if (err instanceof Error && !err.message.toLowerCase().includes('permission')) {
      throw err;
    }
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `farms/${params.farmId}/feedConsumption/${params.consumption.id}`
    );
  }
}

export function subscribeFeedPurchases(
  farmId: string,
  onData: (purchases: FeedPurchase[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 500
) {
  const path = `farms/${farmId}/feedPurchases`;
  const q = query(
    collection(db, 'farms', farmId, 'feedPurchases'),
    orderBy('transactionDate', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FeedPurchase)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export function subscribeFeedConsumption(
  farmId: string,
  onData: (records: FeedConsumption[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 500
) {
  const path = `farms/${farmId}/feedConsumption`;
  const q = query(
    collection(db, 'farms', farmId, 'feedConsumption'),
    orderBy('transactionDate', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FeedConsumption)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function fetchFeedPurchasesByDateRange(
  farmId: string,
  startDate: string,
  endDate: string
): Promise<FeedPurchase[]> {
  const path = `farms/${farmId}/feedPurchases`;
  const q = query(
    collection(db, 'farms', farmId, 'feedPurchases'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as FeedPurchase);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeFeedPurchasesByDateRange(
  farmId: string,
  startDate: string,
  endDate: string,
  onData: (purchases: FeedPurchase[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/feedPurchases`;
  const q = query(
    collection(db, 'farms', farmId, 'feedPurchases'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FeedPurchase)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function fetchFeedConsumptionByDateRange(
  farmId: string,
  startDate: string,
  endDate: string
): Promise<FeedConsumption[]> {
  const path = `farms/${farmId}/feedConsumption`;
  const q = query(
    collection(db, 'farms', farmId, 'feedConsumption'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as FeedConsumption);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeFeedConsumptionByDateRange(
  farmId: string,
  startDate: string,
  endDate: string,
  onData: (records: FeedConsumption[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/feedConsumption`;
  const q = query(
    collection(db, 'farms', farmId, 'feedConsumption'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as FeedConsumption)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

