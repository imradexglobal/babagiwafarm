import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { convertFeedToGrams, generateId } from '../domain/calculations.ts';
import { validateInventoryDelta } from '../domain/eggStore.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { AccountPayment, AccountPaymentMethod, Customer, InvoicePaymentStatus, PurchaseInvoice, PurchaseInvoiceLine, SalesInvoice, SalesInvoiceLine, Vendor } from '../types/accounts.ts';
import type { FarmMember, FeedItem, FeedPurchase, FeedStock, FeedUnit, PoultryBatch, PurchaseCategory, EggSale, SalesUnit, FarmPurchase } from '../types/farm.ts';
import type { EggInventoryBalance, EggInventoryMovement, EggStoreSettings } from '../types/eggStore.ts';

const root = (farmId: string) => ['farms', farmId] as const;
const partyCollection = (kind: 'customer' | 'vendor') => kind === 'customer' ? 'customers' : 'vendors';

export function subscribeCustomers(farmId: string, onData: (rows: Customer[]) => void, onError: (e: Error) => void) {
  return subscribeNamedCollection(farmId, 'customers', onData, onError, 'name');
}
export function subscribeVendors(farmId: string, onData: (rows: Vendor[]) => void, onError: (e: Error) => void) {
  return subscribeNamedCollection(farmId, 'vendors', onData, onError, 'name');
}
export function subscribeSalesInvoices(farmId: string, onData: (rows: SalesInvoice[]) => void, onError: (e: Error) => void) {
  return subscribeNamedCollection(farmId, 'salesInvoices', onData, onError, 'transactionDate');
}
export function subscribePurchaseInvoices(farmId: string, onData: (rows: PurchaseInvoice[]) => void, onError: (e: Error) => void) {
  return subscribeNamedCollection(farmId, 'purchaseInvoices', onData, onError, 'transactionDate');
}
export function subscribeAccountPayments(farmId: string, onData: (rows: AccountPayment[]) => void, onError: (e: Error) => void) {
  return subscribeNamedCollection(farmId, 'accountPayments', onData, onError, 'transactionDate');
}
function subscribeNamedCollection<T>(farmId: string, name: string, onData: (rows: T[]) => void, onError: (e: Error) => void, field: string) {
  const path = `farms/${farmId}/${name}`;
  const q = query(collection(db, ...root(farmId), name), orderBy(field, 'desc'), limit(1000));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => d.data() as T)), (err) => {
    try { handleFirestoreError(err, OperationType.LIST, path); } catch (e) { onError(e as Error); }
  });
}

export async function saveParty(params: {
  farmId: string;
  kind: 'customer' | 'vendor';
  partyId?: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  openingBalanceNgn: number;
  openingBalanceDate: string;
  actorUid: string;
}): Promise<string> {
  const name = params.name.trim();
  if (name.length < 2 || name.length > 150) throw new Error('Enter a name between 2 and 150 characters.');
  if (!Number.isFinite(params.openingBalanceNgn) || params.openingBalanceNgn < 0) throw new Error('Opening balance must be zero or positive.');
  if (params.openingBalanceNgn > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(params.openingBalanceDate)) throw new Error('Choose an opening-balance date.');
  const id = params.partyId || generateId(params.kind);
  const ref = doc(db, ...root(params.farmId), partyCollection(params.kind), id);
  const payload = {
    id, farmId: params.farmId, name, phone: params.phone.trim().slice(0, 40), email: params.email.trim().slice(0, 200),
    address: params.address.trim().slice(0, 300), notes: params.notes.trim().slice(0, 500),
    openingBalanceNgn: Math.round(params.openingBalanceNgn * 100) / 100,
    openingBalanceDate: params.openingBalanceNgn > 0 ? params.openingBalanceDate : '',
    status: 'active' as const, createdBy: params.actorUid, updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const previous = snap.data();
        tx.set(ref, { ...payload, createdBy: previous.createdBy, createdAt: previous.createdAt });
      } else {
        tx.set(ref, { ...payload, createdAt: serverTimestamp() });
      }
    });
    return id;
  } catch (err) {
    if (err instanceof Error && /Enter a name|Opening balance|Choose an opening/.test(err.message)) throw err;
    handleFirestoreError(err, params.partyId ? OperationType.UPDATE : OperationType.CREATE, `farms/${params.farmId}/${partyCollection(params.kind)}/${id}`);
  }
}

export async function setPartyStatus(params: { farmId: string; kind: 'customer' | 'vendor'; party: Customer | Vendor; status: 'active' | 'inactive'; actorUid: string }): Promise<void> {
  const ref = doc(db, ...root(params.farmId), partyCollection(params.kind), params.party.id);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Party record no longer exists.');
      tx.update(ref, { status: params.status, updatedBy: params.actorUid, updatedAt: serverTimestamp() });
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('no longer exists')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, ref.path);
  }
}

export async function postAccountPayment(params: {
  farmId: string;
  direction: AccountPayment['direction'];
  party: Customer | Vendor;
  invoice?: SalesInvoice | PurchaseInvoice | null;
  transactionDate: string;
  amountNgn: number;
  method: AccountPaymentMethod;
  reference: string;
  remarks: string;
  actor: FarmMember;
}): Promise<string> {
  if (!Number.isFinite(params.amountNgn) || params.amountNgn <= 0) throw new Error('Payment amount must be greater than zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.transactionDate)) throw new Error('Choose a valid payment date.');
  const id = generateId('pay');
  const paymentRef = doc(db, ...root(params.farmId), 'accountPayments', id);
  const partyKind = params.direction === 'customer_receipt' ? 'customer' : 'vendor';
  const partyRef = doc(db, ...root(params.farmId), partyCollection(partyKind), params.party.id);
  const expectedInvoiceCollection = params.direction === 'customer_receipt' ? 'salesInvoices' : 'purchaseInvoices';
  const invoiceRef = params.invoice ? doc(db, ...root(params.farmId), expectedInvoiceCollection, params.invoice.id) : null;
  try {
    await runTransaction(db, async (tx) => {
      const partySnap = await tx.get(partyRef);
      const invoiceSnap = invoiceRef ? await tx.get(invoiceRef) : null;
      if (!partySnap.exists()) throw new Error('The selected party no longer exists.');
      if ((partySnap.data() as Customer | Vendor).status !== 'active') throw new Error('Only active customers and vendors can receive payments.');
      let invoiceNumber = '';
      if (invoiceRef && invoiceSnap) {
        if (!invoiceSnap.exists()) throw new Error('The selected invoice no longer exists.');
        const invoice = invoiceSnap.data() as SalesInvoice | PurchaseInvoice;
        const matchingParty = 'customerId' in invoice ? invoice.customerId === params.party.id : invoice.vendorId === params.party.id;
        if (!matchingParty || invoice.isVoided) throw new Error('The selected invoice does not belong to this active account.');
        if (params.amountNgn > invoice.balanceNgn) throw new Error(`Payment exceeds the invoice balance of ₦${invoice.balanceNgn.toLocaleString()}.`);
        const paidAmountNgn = Math.round((invoice.paidAmountNgn + params.amountNgn) * 100) / 100;
        const totalAmountNgn = invoice.totalAmountNgn;
        const balanceNgn = Math.max(0, Math.round((totalAmountNgn - paidAmountNgn) * 100) / 100);
        const paymentStatus = balanceNgn <= 0 ? 'paid' : paidAmountNgn > 0 ? 'partial' : 'unpaid';
        tx.update(invoiceRef, { paidAmountNgn, balanceNgn, paymentStatus, updatedBy: params.actor.uid, updatedAt: serverTimestamp() });
        invoiceNumber = invoice.invoiceNumber;
      }
      const record: AccountPayment = {
        id, farmId: params.farmId, direction: params.direction, partyId: params.party.id,
        partyNameSnapshot: params.party.name.slice(0, 150), invoiceId: params.invoice?.id || '',
        invoiceNumberSnapshot: invoiceNumber, transactionDate: params.transactionDate,
        amountNgn: Math.round(params.amountNgn * 100) / 100, method: params.method,
        reference: params.reference.trim().slice(0, 80), remarks: params.remarks.trim().slice(0, 500),
        isVoided: false, voidReason: '', createdBy: params.actor.uid,
        createdByName: params.actor.displayName.slice(0, 150), createdAt: serverTimestamp(),
      };
      tx.set(paymentRef, record);
    });
    return id;
  } catch (err) {
    if (err instanceof Error && /no longer exists|Only active|does not belong|Payment exceeds/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.CREATE, paymentRef.path);
  }
}

export interface SalesInvoiceLineInput {
  salesUnit: SalesUnit;
  eggCategory: string;
  quantity: number;
  unitPriceNgn: number;
  suggestedUnitPriceNgn: number;
  priceOverridden: boolean;
  overrideReason?: string;
  batch?: PoultryBatch | null;
  stockLot?: EggInventoryBalance | null;
  remarks?: string;
}

export function generateInvoiceNumber(dateStr: string, prefix: 'INV' | 'BILL'): string {
  const cleanDate = (dateStr || '').replace(/-/g, '').slice(2, 6);
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${cleanDate || '26'}-${rand}`;
}

export async function createSalesInvoice(params: {
  farmId: string;
  transactionDate: string;
  transactionTime?: string;
  customer: Customer | null;
  walkInCustomerName?: string;
  lines: SalesInvoiceLineInput[];
  discountNgn?: number;
  paymentStatus: InvoicePaymentStatus;
  paymentMethod: AccountPaymentMethod | '';
  paymentReference?: string;
  amountPaidNgn?: number;
  remarks?: string;
  salesMode?: 'phantom' | 'true_inventory';
  eggStoreSettings?: EggStoreSettings | null;
  actor: FarmMember;
}): Promise<string> {
  if (!params.lines.length) throw new Error('Add at least one product line item to create an invoice.');
  const isWalkIn = !params.customer;

  // Walk-in customer business rule: immediate payment only, no credit
  if (isWalkIn) {
    if (params.paymentStatus !== 'paid') {
      throw new Error('Walk-in customers cannot buy on credit and must pay immediately in full.');
    }
    if (!params.paymentMethod) {
      throw new Error('Select a payment method for the walk-in customer (Cash, Bank Transfer, POS, etc.).');
    }
  }

  let subtotalNgn = 0;
  for (const line of params.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error('All line item quantities must be greater than zero.');
    }
    if (!Number.isFinite(line.unitPriceNgn) || line.unitPriceNgn < 0) {
      throw new Error('All line unit prices must be zero or positive.');
    }
    subtotalNgn += Math.round(line.quantity * line.unitPriceNgn * 100) / 100;
  }
  subtotalNgn = Math.round(subtotalNgn * 100) / 100;
  const discountNgn = Math.max(0, Math.round((params.discountNgn || 0) * 100) / 100);
  const totalAmountNgn = Math.max(0, Math.round((subtotalNgn - discountNgn) * 100) / 100);

  let paidAmountNgn = 0;
  if (params.paymentStatus === 'paid') {
    paidAmountNgn = totalAmountNgn;
  } else if (params.paymentStatus === 'partial') {
    paidAmountNgn = Math.max(0, Math.min(totalAmountNgn, Math.round((params.amountPaidNgn || 0) * 100) / 100));
    if (paidAmountNgn <= 0) throw new Error('Enter a partial amount paid greater than zero, or select Unpaid.');
    if (!params.paymentMethod) throw new Error('Select a payment method for the partial payment.');
  } else {
    paidAmountNgn = 0;
  }
  const balanceNgn = Math.max(0, Math.round((totalAmountNgn - paidAmountNgn) * 100) / 100);

  const invoiceId = generateId('inv');
  const invoiceNumber = generateInvoiceNumber(params.transactionDate, 'INV');
  const customerNameSnapshot = isWalkIn
    ? (params.walkInCustomerName?.trim() || 'Walk-in Customer')
    : params.customer!.name;

  const invoiceLines: SalesInvoiceLine[] = params.lines.map((l) => {
    const eggsPerUnit = l.salesUnit.eggCountPerUnit;
    const totalEggs = Math.round(l.quantity * eggsPerUnit);
    const lineTotal = Math.round(l.quantity * l.unitPriceNgn * 100) / 100;
    const eggSaleId = generateId('sale');
    return {
      id: generateId('line'),
      eggSaleId,
      grade: l.eggCategory,
      eggCategory: l.eggCategory,
      salesUnitId: l.salesUnit.id,
      unitNameSnapshot: l.salesUnit.name,
      eggsPerUnitSnapshot: eggsPerUnit,
      quantity: l.quantity,
      totalEggs,
      unitPriceNgn: l.unitPriceNgn,
      discountNgn: 0,
      totalAmountNgn: lineTotal,
      suggestedUnitPriceNgn: l.suggestedUnitPriceNgn,
      priceOverridden: l.priceOverridden,
      overrideReason: l.overrideReason || '',
      batchId: l.batch?.id || '',
      batchCodeSnapshot: l.batch?.batchCode || '',
      sourcePenId: l.stockLot?.sourcePenId || '',
      sourcePenNameSnapshot: l.stockLot?.sourcePenNameSnapshot || '',
      remarks: l.remarks || '',
    };
  });

  const invoiceRef = doc(db, ...root(params.farmId), 'salesInvoices', invoiceId);
  const isTrueInventory = params.salesMode === 'true_inventory';

  try {
    await runTransaction(db, async (tx) => {
      // If true-inventory, verify balances
      const balanceUpdates: { ref: any; nextBalance: number; movementRef: any; movementData: any }[] = [];
      if (isTrueInventory) {
        for (let idx = 0; idx < params.lines.length; idx++) {
          const line = params.lines[idx];
          const invoiceLine = invoiceLines[idx];
          if (!line.stockLot) throw new Error(`Select a stock lot for ${line.salesUnit.name} (${line.eggCategory}) in True Inventory mode.`);
          const balRef = doc(db, ...root(params.farmId), 'eggInventoryBalances', line.stockLot.id);
          const balSnap = await tx.get(balRef);
          if (!balSnap.exists()) throw new Error(`Stock lot for ${line.eggCategory} no longer exists.`);
          const currentBal = balSnap.data() as EggInventoryBalance;
          const nextBal = validateInventoryDelta(currentBal.balanceEggs, -invoiceLine.totalEggs, currentBal.category);
          const mvId = generateId('mv');
          const mvRef = doc(db, ...root(params.farmId), 'eggInventoryMovements', mvId);
          balanceUpdates.push({
            ref: balRef,
            nextBalance: nextBal,
            movementRef: mvRef,
            movementData: {
              id: mvId,
              farmId: params.farmId,
              movementType: 'sale',
              category: currentBal.category,
              balanceId: currentBal.id,
              quantityDelta: -invoiceLine.totalEggs,
              sourcePenId: currentBal.sourcePenId,
              sourcePenNameSnapshot: currentBal.sourcePenNameSnapshot,
              lotId: currentBal.lotId,
              productionEntryId: '',
              transferId: '',
              receiptId: '',
              sortingBatchId: '',
              invoiceId,
              invoiceLineId: invoiceLine.id,
              reference: invoiceLine.eggSaleId,
              transactionDate: params.transactionDate,
              reason: `Sales Invoice ${invoiceNumber}`,
              remarks: line.remarks || '',
              actorUid: params.actor.uid,
              actorName: params.actor.displayName.slice(0, 150),
              createdAt: serverTimestamp(),
            },
          });
        }
      }

      // Write true-inventory stock decrements
      for (const update of balanceUpdates) {
        tx.update(update.ref, { balanceEggs: update.nextBalance, lastMovementId: update.movementData.id, updatedAt: serverTimestamp() });
        tx.set(update.movementRef, update.movementData);
      }

      // Write corresponding eggSales records for analytics & batch attribution
      for (let idx = 0; idx < params.lines.length; idx++) {
        const line = params.lines[idx];
        const invoiceLine = invoiceLines[idx];
        const saleRef = doc(db, ...root(params.farmId), 'eggSales', invoiceLine.eggSaleId);
        const saleData = {
          id: invoiceLine.eggSaleId,
          farmId: params.farmId,
          transactionDate: params.transactionDate,
          transactionTime: (params.transactionTime || '').slice(0, 5),
          customerName: customerNameSnapshot,
          eggCategory: line.eggCategory,
          salesUnitId: line.salesUnit.id,
          unitNameSnapshot: line.salesUnit.name,
          eggsPerUnitSnapshot: line.salesUnit.eggCountPerUnit,
          quantity: line.quantity,
          totalEggsEquivalent: invoiceLine.totalEggs,
          suggestedUnitPriceNgn: line.suggestedUnitPriceNgn,
          unitPriceNgn: line.unitPriceNgn,
          priceOverridden: line.priceOverridden,
          overrideReason: line.overrideReason || '',
          totalAmountNgn: invoiceLine.totalAmountNgn,
          paymentStatus: params.paymentStatus,
          batchId: line.batch?.id || '',
          batchCodeSnapshot: line.batch?.batchCode || '',
          remarks: `Invoice ${invoiceNumber}: ${line.remarks || ''}`.trim().slice(0, 500),
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          createdBy: params.actor.uid,
          createdByName: params.actor.displayName.slice(0, 150),
          updatedBy: params.actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        tx.set(saleRef, saleData);
      }

      // Write Master Sales Invoice
      const invoiceData: SalesInvoice = {
        id: invoiceId,
        farmId: params.farmId,
        invoiceNumber,
        transactionDate: params.transactionDate,
        transactionTime: (params.transactionTime || '').slice(0, 5),
        customerId: isWalkIn ? 'walk-in' : params.customer!.id,
        customerNameSnapshot,
        lines: invoiceLines,
        subtotalNgn,
        discountNgn,
        totalAmountNgn,
        paidAmountNgn,
        balanceNgn,
        paymentStatus: params.paymentStatus,
        salesMode: isTrueInventory ? 'true_inventory' : 'phantom',
        paymentMethod: paidAmountNgn > 0 ? (params.paymentMethod || 'cash') : '',
        paymentReference: (params.paymentReference || '').trim().slice(0, 80),
        remarks: (params.remarks || '').trim().slice(0, 500),
        isVoided: false,
        voidReason: '',
        createdBy: params.actor.uid,
        createdByName: params.actor.displayName.slice(0, 150),
        updatedBy: params.actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      tx.set(invoiceRef, invoiceData);

      // Write AccountPayment if immediate payment made
      if (paidAmountNgn > 0) {
        const paymentId = generateId('pay');
        const paymentRef = doc(db, ...root(params.farmId), 'accountPayments', paymentId);
        const paymentRecord: AccountPayment = {
          id: paymentId,
          farmId: params.farmId,
          direction: 'customer_receipt',
          partyId: isWalkIn ? 'walk-in' : params.customer!.id,
          partyNameSnapshot: customerNameSnapshot,
          invoiceId,
          invoiceNumberSnapshot: invoiceNumber,
          transactionDate: params.transactionDate,
          amountNgn: paidAmountNgn,
          method: params.paymentMethod || 'cash',
          reference: (params.paymentReference || '').trim().slice(0, 80),
          remarks: `Payment for invoice ${invoiceNumber}`,
          isVoided: false,
          voidReason: '',
          createdBy: params.actor.uid,
          createdByName: params.actor.displayName.slice(0, 150),
          createdAt: serverTimestamp(),
        };
        tx.set(paymentRef, paymentRecord);
      }
    });

    return invoiceId;
  } catch (err) {
    if (err instanceof Error && /Walk-in|greater than zero|Stock lot|Select a stock lot|Insufficient/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.CREATE, invoiceRef.path);
  }
}

export interface PurchaseInvoiceLineInput {
  lineType: 'feed' | 'general';
  feedItem?: FeedItem;
  enteredQuantity?: number;
  enteredUnit?: FeedUnit;
  bagWeightKg?: number;
  category?: PurchaseCategory;
  itemName?: string;
  quantity?: number;
  unit?: string;
  unitPriceNgn: number;
  batch?: PoultryBatch | null;
  remarks?: string;
}

export async function createPurchaseInvoice(params: {
  farmId: string;
  transactionDate: string;
  vendor: Vendor | null;
  oneOffSupplierName?: string;
  reference?: string;
  lines: PurchaseInvoiceLineInput[];
  paymentStatus: InvoicePaymentStatus;
  paymentMethod: AccountPaymentMethod | '';
  paymentReference?: string;
  amountPaidNgn?: number;
  remarks?: string;
  actor: FarmMember;
}): Promise<string> {
  if (!params.lines.length) throw new Error('Add at least one purchase line item.');
  const isOneOff = !params.vendor;

  if (isOneOff) {
    if (params.paymentStatus !== 'paid') {
      throw new Error('One-off / Walk-in suppliers cannot provide credit; payment must be recorded in full.');
    }
    if (!params.paymentMethod) {
      throw new Error('Select a payment method for the supplier (Cash, Bank Transfer, POS, etc.).');
    }
  }

  let subtotalNgn = 0;
  for (const line of params.lines) {
    const qty = line.lineType === 'feed' ? (line.enteredQuantity || 0) : (line.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('All purchase line quantities must be greater than zero.');
    if (!Number.isFinite(line.unitPriceNgn) || line.unitPriceNgn < 0) throw new Error('All line unit prices must be zero or positive.');
    subtotalNgn += Math.round(qty * line.unitPriceNgn * 100) / 100;
  }
  subtotalNgn = Math.round(subtotalNgn * 100) / 100;
  const totalAmountNgn = subtotalNgn;

  let paidAmountNgn = 0;
  if (params.paymentStatus === 'paid') {
    paidAmountNgn = totalAmountNgn;
  } else if (params.paymentStatus === 'partial') {
    paidAmountNgn = Math.max(0, Math.min(totalAmountNgn, Math.round((params.amountPaidNgn || 0) * 100) / 100));
    if (paidAmountNgn <= 0) throw new Error('Enter a partial amount paid greater than zero, or select Unpaid.');
    if (!params.paymentMethod) throw new Error('Select a payment method for the partial payment.');
  } else {
    paidAmountNgn = 0;
  }
  const balanceNgn = Math.max(0, Math.round((totalAmountNgn - paidAmountNgn) * 100) / 100);

  const invoiceId = generateId('pinv');
  const invoiceNumber = generateInvoiceNumber(params.transactionDate, 'BILL');
  const vendorNameSnapshot = isOneOff
    ? (params.oneOffSupplierName?.trim() || 'One-off Supplier')
    : params.vendor!.name;

  const invoiceLines: PurchaseInvoiceLine[] = params.lines.map((l) => {
    const isFeed = l.lineType === 'feed';
    const qty = isFeed ? (l.enteredQuantity || 0) : (l.quantity || 0);
    const lineTotal = Math.round(qty * l.unitPriceNgn * 100) / 100;
    const sourceRecordId = generateId(isFeed ? 'pur' : 'fpur');
    const bagWeight = isFeed ? (l.bagWeightKg || l.feedItem?.defaultBagWeightKg || 25) : 0;
    const stdGrams = isFeed ? convertFeedToGrams(qty, l.enteredUnit || 'kg', bagWeight) : 0;

    return {
      id: generateId('pline'),
      lineType: l.lineType,
      sourceRecordId,
      category: isFeed ? 'feed' : (l.category || 'other'),
      itemNameSnapshot: isFeed ? (l.feedItem?.feedType || 'Feed') : (l.itemName || 'Item'),
      feedItemId: isFeed ? (l.feedItem?.id || '') : '',
      feedTypeSnapshot: isFeed ? (l.feedItem?.feedType || '') : '',
      brandSnapshot: isFeed ? (l.feedItem?.brand || '') : '',
      quantity: qty,
      unit: isFeed ? (l.enteredUnit || 'kg') : (l.unit || 'units'),
      bagWeightKgSnapshot: bagWeight,
      standardizedGrams: stdGrams,
      unitPriceNgn: l.unitPriceNgn,
      totalAmountNgn: lineTotal,
      batchId: l.batch?.id || '',
      batchCodeSnapshot: l.batch?.batchCode || '',
      remarks: l.remarks || '',
    };
  });

  const invoiceRef = doc(db, ...root(params.farmId), 'purchaseInvoices', invoiceId);

  try {
    await runTransaction(db, async (tx) => {
      // 1. Process feed items (increment feedStock and create feedPurchases)
      for (let idx = 0; idx < params.lines.length; idx++) {
        const line = params.lines[idx];
        const invLine = invoiceLines[idx];
        if (line.lineType === 'feed' && line.feedItem) {
          const stockRef = doc(db, ...root(params.farmId), 'feedStock', line.feedItem.id);
          const stockSnap = await tx.get(stockRef);
          const curBal = stockSnap.exists() ? (stockSnap.data() as FeedStock).balanceGrams : 0;
          const curLastDate = stockSnap.exists() ? (stockSnap.data() as FeedStock).lastPurchaseDate : '';
          const isNewerOrSame = !curLastDate || params.transactionDate >= curLastDate;
          const unitCostPerGramNgn = invLine.standardizedGrams > 0 ? (invLine.totalAmountNgn / invLine.standardizedGrams) : 0;

          const feedPurRef = doc(db, ...root(params.farmId), 'feedPurchases', invLine.sourceRecordId);
          tx.set(feedPurRef, {
            id: invLine.sourceRecordId,
            farmId: params.farmId,
            transactionDate: params.transactionDate,
            feedItemId: line.feedItem.id,
            feedTypeSnapshot: line.feedItem.feedType,
            brandSnapshot: line.feedItem.brand,
            enteredQuantity: invLine.quantity,
            enteredUnit: invLine.unit,
            bagWeightKgSnapshot: invLine.bagWeightKgSnapshot,
            standardizedGrams: invLine.standardizedGrams,
            unitPurchasePriceNgn: invLine.unitPriceNgn,
            totalCostNgn: invLine.totalAmountNgn,
            unitCostPerGramNgn,
            supplier: vendorNameSnapshot,
            reference: params.reference || invoiceNumber,
            remarks: `Bill ${invoiceNumber}: ${line.remarks || ''}`.trim().slice(0, 500),
            isVoided: false,
            voidReason: '',
            voidedBy: '',
            createdBy: params.actor.uid,
            createdByName: params.actor.displayName.slice(0, 150),
            updatedBy: params.actor.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          const nextStock: FeedStock = {
            feedItemId: line.feedItem.id,
            farmId: params.farmId,
            feedType: line.feedItem.feedType,
            brand: line.feedItem.brand,
            balanceGrams: Math.round((curBal + invLine.standardizedGrams) * 1000) / 1000,
            lastPurchaseDate: isNewerOrSame ? params.transactionDate : curLastDate,
            lastUnitCostPerGramNgn: isNewerOrSame ? unitCostPerGramNgn : (stockSnap.exists() ? (stockSnap.data() as FeedStock).lastUnitCostPerGramNgn : unitCostPerGramNgn),
            updatedAt: serverTimestamp(),
          };
          if (stockSnap.exists()) {
            tx.update(stockRef, { ...nextStock, updatedAt: serverTimestamp() });
          } else {
            tx.set(stockRef, nextStock);
          }
        } else if (line.lineType === 'general') {
          // Process general farm purchases
          const farmPurRef = doc(db, ...root(params.farmId), 'farmPurchases', invLine.sourceRecordId);
          tx.set(farmPurRef, {
            id: invLine.sourceRecordId,
            farmId: params.farmId,
            transactionDate: params.transactionDate,
            category: line.category || 'other',
            itemName: line.itemName || 'General Expense',
            quantity: invLine.quantity,
            unit: invLine.unit,
            unitPriceNgn: invLine.unitPriceNgn,
            totalCostNgn: invLine.totalAmountNgn,
            supplier: vendorNameSnapshot,
            reference: params.reference || invoiceNumber,
            batchId: line.batch?.id || '',
            batchCodeSnapshot: line.batch?.batchCode || '',
            remarks: `Bill ${invoiceNumber}: ${line.remarks || ''}`.trim().slice(0, 500),
            isVoided: false,
            voidReason: '',
            voidedBy: '',
            createdBy: params.actor.uid,
            createdByName: params.actor.displayName.slice(0, 150),
            updatedBy: params.actor.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      // 2. Write Master Purchase Invoice
      const invoiceData: PurchaseInvoice = {
        id: invoiceId,
        farmId: params.farmId,
        invoiceNumber,
        transactionDate: params.transactionDate,
        vendorId: isOneOff ? 'one-off' : params.vendor!.id,
        vendorNameSnapshot,
        reference: (params.reference || '').trim().slice(0, 80),
        lines: invoiceLines,
        subtotalNgn,
        totalAmountNgn,
        paidAmountNgn,
        balanceNgn,
        paymentStatus: params.paymentStatus,
        paymentMethod: paidAmountNgn > 0 ? (params.paymentMethod || 'cash') : '',
        paymentReference: (params.paymentReference || '').trim().slice(0, 80),
        remarks: (params.remarks || '').trim().slice(0, 500),
        isVoided: false,
        voidReason: '',
        createdBy: params.actor.uid,
        createdByName: params.actor.displayName.slice(0, 150),
        updatedBy: params.actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      tx.set(invoiceRef, invoiceData);

      // 3. Write AccountPayment if immediate payment made
      if (paidAmountNgn > 0) {
        const paymentId = generateId('pay');
        const paymentRef = doc(db, ...root(params.farmId), 'accountPayments', paymentId);
        const paymentRecord: AccountPayment = {
          id: paymentId,
          farmId: params.farmId,
          direction: 'vendor_payment',
          partyId: isOneOff ? 'one-off' : params.vendor!.id,
          partyNameSnapshot: vendorNameSnapshot,
          invoiceId,
          invoiceNumberSnapshot: invoiceNumber,
          transactionDate: params.transactionDate,
          amountNgn: paidAmountNgn,
          method: params.paymentMethod || 'cash',
          reference: (params.paymentReference || '').trim().slice(0, 80),
          remarks: `Payment for bill ${invoiceNumber}`,
          isVoided: false,
          voidReason: '',
          createdBy: params.actor.uid,
          createdByName: params.actor.displayName.slice(0, 150),
          createdAt: serverTimestamp(),
        };
        tx.set(paymentRef, paymentRecord);
      }
    });

    return invoiceId;
  } catch (err) {
    if (err instanceof Error && /One-off|greater than zero/.test(err.message)) throw err;
    handleFirestoreError(err, OperationType.CREATE, invoiceRef.path);
  }
}

export async function voidSalesInvoice(params: {
  farmId: string;
  invoice: SalesInvoice;
  voidReason: string;
  actor: FarmMember;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.invoice.isVoided) throw new Error('Invoice is already voided.');

  const invoiceRef = doc(db, ...root(params.farmId), 'salesInvoices', params.invoice.id);

  // 1. Fetch any linked payments
  const paymentsQ = query(
    collection(db, ...root(params.farmId), 'accountPayments'),
    where('invoiceId', '==', params.invoice.id)
  );
  const paymentsSnap = await getDocs(paymentsQ);
  const paymentsToVoid = paymentsSnap.docs
    .map((d) => d.data() as AccountPayment)
    .filter((p) => !p.isVoided);

  // 2. Fetch any eggInventoryMovements linked to this invoice or its lines
  const movementsQ = query(
    collection(db, ...root(params.farmId), 'eggInventoryMovements'),
    where('invoiceId', '==', params.invoice.id)
  );
  const movementsSnap = await getDocs(movementsQ);
  const movementsToReverse = movementsSnap.docs
    .map((d) => d.data() as EggInventoryMovement)
    .filter((m) => m.movementType === 'sale' && m.quantityDelta < 0);

  try {
    await runTransaction(db, async (tx) => {
      // Void invoice
      tx.update(invoiceRef, {
        isVoided: true,
        voidReason: reason.slice(0, 300),
        updatedBy: params.actor.uid,
        updatedAt: serverTimestamp(),
      });

      // Void individual egg sales
      for (const line of params.invoice.lines) {
        const saleRef = doc(db, ...root(params.farmId), 'eggSales', line.eggSaleId);
        tx.update(saleRef, {
          isVoided: true,
          voidReason: `Voided via Invoice ${params.invoice.invoiceNumber}: ${reason}`.slice(0, 300),
          voidedBy: params.actor.uid,
          updatedBy: params.actor.uid,
          updatedAt: serverTimestamp(),
        });
      }

      // Void linked account payments
      for (const pay of paymentsToVoid) {
        const payRef = doc(db, ...root(params.farmId), 'accountPayments', pay.id);
        tx.update(payRef, {
          isVoided: true,
          voidReason: `Voided via Invoice ${params.invoice.invoiceNumber}: ${reason}`.slice(0, 300),
          voidedBy: params.actor.uid,
          updatedAt: serverTimestamp(),
        });
      }

      // Restore true inventory balances if any
      for (const mv of movementsToReverse) {
        const balRef = doc(db, ...root(params.farmId), 'eggInventoryBalances', mv.balanceId);
        const balSnap = await tx.get(balRef);
        if (balSnap.exists()) {
          const bal = balSnap.data() as EggInventoryBalance;
          const restoredEggs = bal.balanceEggs + Math.abs(mv.quantityDelta);
          const reversalMvId = generateId('mv');
          const reversalMvRef = doc(db, ...root(params.farmId), 'eggInventoryMovements', reversalMvId);
          tx.update(balRef, { balanceEggs: restoredEggs, lastMovementId: reversalMvId, updatedAt: serverTimestamp() });
          tx.set(reversalMvRef, {
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
            invoiceId: params.invoice.id,
            invoiceLineId: mv.invoiceLineId || '',
            reference: mv.reference || params.invoice.id,
            transactionDate: params.invoice.transactionDate,
            reason: 'Voided sales invoice',
            remarks: reason.slice(0, 500),
            actorUid: params.actor.uid,
            actorName: params.actor.displayName.slice(0, 150),
            createdAt: serverTimestamp(),
          });
        }
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, invoiceRef.path);
  }
}

export async function voidPurchaseInvoice(params: {
  farmId: string;
  invoice: PurchaseInvoice;
  voidReason: string;
  actor: FarmMember;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.invoice.isVoided) throw new Error('Purchase invoice is already voided.');

  const invoiceRef = doc(db, ...root(params.farmId), 'purchaseInvoices', params.invoice.id);

  // 1. Fetch any linked payments
  const paymentsQ = query(
    collection(db, ...root(params.farmId), 'accountPayments'),
    where('invoiceId', '==', params.invoice.id)
  );
  const paymentsSnap = await getDocs(paymentsQ);
  const paymentsToVoid = paymentsSnap.docs
    .map((d) => d.data() as AccountPayment)
    .filter((p) => !p.isVoided);

  try {
    await runTransaction(db, async (tx) => {
      // 1. Mark invoice voided
      tx.update(invoiceRef, {
        isVoided: true,
        voidReason: reason.slice(0, 300),
        updatedBy: params.actor.uid,
        updatedAt: serverTimestamp(),
      });

      // 2. Void individual line records and reverse feedStock if feed
      for (const line of params.invoice.lines) {
        if (line.lineType === 'feed') {
          const purRef = doc(db, ...root(params.farmId), 'feedPurchases', line.sourceRecordId);
          tx.update(purRef, {
            isVoided: true,
            voidReason: `Voided via Bill ${params.invoice.invoiceNumber}: ${reason}`.slice(0, 300),
            voidedBy: params.actor.uid,
            updatedBy: params.actor.uid,
            updatedAt: serverTimestamp(),
          });

          // Deduct from feed stock
          if (line.feedItemId && line.standardizedGrams > 0) {
            const stockRef = doc(db, ...root(params.farmId), 'feedStock', line.feedItemId);
            const stockSnap = await tx.get(stockRef);
            if (stockSnap.exists()) {
              const curBal = (stockSnap.data() as FeedStock).balanceGrams;
              const nextBal = Math.max(0, curBal - line.standardizedGrams);
              tx.update(stockRef, { balanceGrams: nextBal, updatedAt: serverTimestamp() });
            }
          }
        } else {
          const fpurRef = doc(db, ...root(params.farmId), 'farmPurchases', line.sourceRecordId);
          tx.update(fpurRef, {
            isVoided: true,
            voidReason: `Voided via Bill ${params.invoice.invoiceNumber}: ${reason}`.slice(0, 300),
            voidedBy: params.actor.uid,
            updatedBy: params.actor.uid,
            updatedAt: serverTimestamp(),
          });
        }
      }

      // 3. Void linked account payments
      for (const pay of paymentsToVoid) {
        const payRef = doc(db, ...root(params.farmId), 'accountPayments', pay.id);
        tx.update(payRef, {
          isVoided: true,
          voidReason: `Voided via Bill ${params.invoice.invoiceNumber}: ${reason}`.slice(0, 300),
          voidedBy: params.actor.uid,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, invoiceRef.path);
  }
}

export async function voidAccountPayment(params: {
  farmId: string;
  payment: AccountPayment;
  voidReason: string;
  actor: FarmMember;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.payment.isVoided) throw new Error('Payment is already voided.');

  const paymentRef = doc(db, ...root(params.farmId), 'accountPayments', params.payment.id);

  try {
    await runTransaction(db, async (tx) => {
      // If payment was linked to an invoice, restore the invoice balance
      if (params.payment.invoiceId) {
        const isSales = params.payment.direction === 'customer_receipt';
        const coll = isSales ? 'salesInvoices' : 'purchaseInvoices';
        const invRef = doc(db, ...root(params.farmId), coll, params.payment.invoiceId);
        const invSnap = await tx.get(invRef);
        if (invSnap.exists()) {
          const inv = invSnap.data() as SalesInvoice | PurchaseInvoice;
          const paidAmountNgn = Math.max(0, Math.round((inv.paidAmountNgn - params.payment.amountNgn) * 100) / 100);
          const balanceNgn = Math.max(0, Math.round((inv.totalAmountNgn - paidAmountNgn) * 100) / 100);
          const paymentStatus = balanceNgn <= 0 ? 'paid' : paidAmountNgn > 0 ? 'partial' : 'unpaid';
          tx.update(invRef, { paidAmountNgn, balanceNgn, paymentStatus, updatedBy: params.actor.uid, updatedAt: serverTimestamp() });
        }
      }

      tx.update(paymentRef, {
        isVoided: true,
        voidReason: reason.slice(0, 300),
        voidedBy: params.actor.uid,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, paymentRef.path);
  }
}
