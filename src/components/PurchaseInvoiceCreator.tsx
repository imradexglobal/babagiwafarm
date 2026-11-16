import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Info,
  Package,
  Plus,
  Printer,
  Search,
  Trash2,
  Truck,
  UserCheck,
  UserPlus,
  Wheat,
  X,
} from 'lucide-react';
import {
  DEFAULT_BAG_WEIGHT_KG,
  convertFeedToGrams,
  formatDateInTimezone,
  formatNgn,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { createPurchaseInvoice, saveParty } from '../services/accountsService.ts';
import {
  PURCHASE_CATEGORIES,
  PURCHASE_CATEGORY_LABEL,
} from '../services/purchasesService.ts';
import type {
  AccountPaymentMethod,
  InvoicePaymentStatus,
  PurchaseInvoice,
  Vendor,
} from '../types/accounts.ts';
import type {
  Farm,
  FarmMember,
  FeedItem,
  FeedUnit,
  PoultryBatch,
  PurchaseCategory,
} from '../types/farm.ts';

export interface PurchaseLineDraft {
  id: string;
  lineType: 'feed' | 'general';
  // Feed fields
  feedItemId: string;
  enteredQuantity: string;
  enteredUnit: FeedUnit;
  bagWeightKg: string;
  // General expense fields
  category: PurchaseCategory;
  itemName: string;
  quantity: string;
  unit: string;
  // Shared fields
  unitPriceNgn: string;
  selectedBatchId: string;
  remarks: string;
}

interface Props {
  farm: Farm;
  member: FarmMember;
  vendors: Vendor[];
  feedItems: FeedItem[];
  batches: PoultryBatch[];
  onCancel: () => void;
  onInvoiceCreated: (invoice: PurchaseInvoice, printImmediately: boolean) => void;
}

const PAYMENT_METHODS: { value: AccountPaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'pos', label: 'POS Terminal' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export const PurchaseInvoiceCreator: React.FC<Props> = ({
  farm,
  member,
  vendors,
  feedItems,
  batches,
  onCancel,
  onInvoiceCreated,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const activeFeedItems = useMemo(() => feedItems.filter((i) => i.status === 'active'), [feedItems]);
  const feedItemById = useMemo(() => new Map(feedItems.map((i) => [i.id, i])), [feedItems]);
  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const activeVendors = useMemo(() => vendors.filter((v) => v.status === 'active'), [vendors]);

  // Vendor selection: null means One-off Supplier
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [oneOffSupplierName, setOneOffSupplierName] = useState('');
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);

  // Quick Add Vendor modal
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorEmail, setNewVendorEmail] = useState('');
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');

  // Bill Fields
  const [txDate, setTxDate] = useState(todayStr);
  const [billReference, setBillReference] = useState('');
  const [billRemarks, setBillRemarks] = useState('');

  // Payment Fields
  const [paymentStatus, setPaymentStatus] = useState<InvoicePaymentStatus>('paid');
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<AccountPaymentMethod>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');

  // Multi-line Items
  const createBlankLine = (lineType: 'feed' | 'general' = 'feed'): PurchaseLineDraft => {
    const firstFeed = activeFeedItems[0];
    return {
      id: Math.random().toString(36).slice(2, 9),
      lineType,
      feedItemId: firstFeed?.id || '',
      enteredQuantity: '10',
      enteredUnit: 'bags',
      bagWeightKg: String(firstFeed?.defaultBagWeightKg || DEFAULT_BAG_WEIGHT_KG),
      category: 'medication',
      itemName: '',
      quantity: '1',
      unit: 'bottle',
      unitPriceNgn: '',
      selectedBatchId: '',
      remarks: '',
    };
  };

  const [lines, setLines] = useState<PurchaseLineDraft[]>([
    activeFeedItems.length > 0 ? createBlankLine('feed') : createBlankLine('general'),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filtered vendor list for combobox
  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return activeVendors;
    return activeVendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.phone.toLowerCase().includes(q) ||
        v.email.toLowerCase().includes(q)
    );
  }, [activeVendors, vendorSearch]);

  const addLine = (lineType: 'feed' | 'general' = 'feed') => {
    setLines((prev) => [...prev, createBlankLine(lineType)]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, patch: Partial<PurchaseLineDraft>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, ...patch };
        if (patch.feedItemId && patch.feedItemId !== l.feedItemId) {
          const item = feedItemById.get(patch.feedItemId);
          if (item) {
            updated.bagWeightKg = String(item.defaultBagWeightKg || DEFAULT_BAG_WEIGHT_KG);
          }
        }
        return updated;
      })
    );
  };

  // Financial Calculations
  const lineCalculations = useMemo(() => {
    return lines.map((line) => {
      const isFeed = line.lineType === 'feed';
      const feedItem = isFeed ? feedItemById.get(line.feedItemId) : undefined;
      const qty = isFeed ? (Number(line.enteredQuantity) || 0) : (Number(line.quantity) || 0);
      const price = Number(line.unitPriceNgn) || 0;
      const bagW = isFeed ? (Number(line.bagWeightKg) || DEFAULT_BAG_WEIGHT_KG) : 0;
      const lineTotal = Math.round(qty * price * 100) / 100;

      let stdKg = 0;
      if (isFeed && qty > 0 && bagW > 0) {
        try {
          const grams = convertFeedToGrams(qty, line.enteredUnit, bagW);
          stdKg = grams / 1000;
        } catch {
          stdKg = 0;
        }
      }

      return {
        isFeed,
        feedItem,
        qty,
        price,
        bagW,
        stdKg,
        lineTotal,
      };
    });
  }, [lines, feedItemById]);

  const totalAmountNgn = useMemo(() => {
    return lineCalculations.reduce((sum, item) => sum + item.lineTotal, 0);
  }, [lineCalculations]);

  // One-off supplier forces paymentStatus = 'paid'
  const isOneOff = !selectedVendor;
  const effectivePaymentStatus: InvoicePaymentStatus = isOneOff ? 'paid' : paymentStatus;

  const effectivePaidAmount = useMemo(() => {
    if (effectivePaymentStatus === 'paid') return totalAmountNgn;
    if (effectivePaymentStatus === 'unpaid') return 0;
    return Math.max(0, Math.min(totalAmountNgn, Number(amountPaid) || 0));
  }, [effectivePaymentStatus, totalAmountNgn, amountPaid]);

  const balanceDueNgn = Math.max(0, Math.round((totalAmountNgn - effectivePaidAmount) * 100) / 100);

  // Quick Vendor Creation
  const handleQuickAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName.trim()) {
      setQuickAddError('Enter a vendor / supplier name.');
      return;
    }
    setQuickAddBusy(true);
    setQuickAddError('');
    try {
      const id = await saveParty({
        farmId: farm.farmId,
        kind: 'vendor',
        name: newVendorName.trim(),
        phone: newVendorPhone.trim(),
        email: newVendorEmail.trim(),
        address: '',
        notes: 'Created during purchase bill creation',
        openingBalanceNgn: 0,
        openingBalanceDate: todayStr,
        actorUid: member.uid,
      });

      const newVend: Vendor = {
        id,
        farmId: farm.farmId,
        name: newVendorName.trim(),
        phone: newVendorPhone.trim(),
        email: newVendorEmail.trim(),
        address: '',
        notes: '',
        openingBalanceNgn: 0,
        openingBalanceDate: todayStr,
        status: 'active',
        createdBy: member.uid,
        updatedBy: member.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      setSelectedVendor(newVend);
      setQuickAddOpen(false);
      setNewVendorName('');
      setNewVendorPhone('');
      setNewVendorEmail('');
    } catch (err) {
      setQuickAddError(formatUserFriendlyError(err));
    } finally {
      setQuickAddBusy(false);
    }
  };

  const handleSaveInvoice = async (printImmediately: boolean) => {
    setFormError(null);
    setSubmitting(true);
    try {
      if (lines.length === 0) throw new Error('Add at least one purchase item.');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const calc = lineCalculations[i];
        if (calc.qty <= 0) throw new Error(`Line ${i + 1}: Quantity must be greater than zero.`);
        if (calc.price <= 0) throw new Error(`Line ${i + 1}: Enter a valid unit purchase price.`);
        if (line.lineType === 'feed' && !line.feedItemId) {
          throw new Error(`Line ${i + 1}: Select a feed brand and type.`);
        }
        if (line.lineType === 'general' && !line.itemName.trim()) {
          throw new Error(`Line ${i + 1}: Enter the item or expense description.`);
        }
      }

      if (effectivePaymentStatus === 'partial' && effectivePaidAmount <= 0) {
        throw new Error('Enter a partial amount paid greater than zero.');
      }

      const invoiceLinesPayload = lines.map((l, idx) => {
        const calc = lineCalculations[idx];
        const selectedBatch = l.selectedBatchId ? batches.find((b) => b.id === l.selectedBatchId) || null : null;

        if (l.lineType === 'feed') {
          return {
            lineType: 'feed' as const,
            feedItem: calc.feedItem!,
            enteredQuantity: calc.qty,
            enteredUnit: l.enteredUnit,
            bagWeightKg: calc.bagW,
            unitPriceNgn: calc.price,
            batch: selectedBatch,
            remarks: l.remarks,
          };
        } else {
          return {
            lineType: 'general' as const,
            category: l.category,
            itemName: l.itemName.trim(),
            quantity: calc.qty,
            unit: l.unit.trim() || 'units',
            unitPriceNgn: calc.price,
            batch: selectedBatch,
            remarks: l.remarks,
          };
        }
      });

      const invoiceId = await createPurchaseInvoice({
        farmId: farm.farmId,
        transactionDate: txDate,
        vendor: selectedVendor,
        oneOffSupplierName: oneOffSupplierName.trim(),
        reference: billReference.trim(),
        lines: invoiceLinesPayload,
        paymentStatus: effectivePaymentStatus,
        paymentMethod: effectivePaidAmount > 0 ? paymentMethod : '',
        paymentReference,
        amountPaidNgn: effectivePaidAmount,
        remarks: billRemarks.trim(),
        actor: member,
      });

      // Construct purchase invoice object for immediate preview / print
      const createdInvoice: PurchaseInvoice = {
        id: invoiceId,
        farmId: farm.farmId,
        invoiceNumber: `BILL-${txDate.replace(/-/g, '').slice(2, 6)}-${invoiceId.slice(-4).toUpperCase()}`,
        transactionDate: txDate,
        vendorId: selectedVendor ? selectedVendor.id : 'one-off',
        vendorNameSnapshot: selectedVendor ? selectedVendor.name : (oneOffSupplierName.trim() || 'One-off Supplier'),
        reference: billReference.trim(),
        lines: invoiceLinesPayload.map((l, index) => ({
          id: `pline-${index}`,
          lineType: l.lineType,
          sourceRecordId: `rec-${index}`,
          category: l.lineType === 'feed' ? 'feed' : (l.category || 'other'),
          itemNameSnapshot: l.lineType === 'feed' ? (l.feedItem?.feedType || 'Feed') : (l.itemName || 'Item'),
          feedItemId: l.lineType === 'feed' ? (l.feedItem?.id || '') : '',
          feedTypeSnapshot: l.lineType === 'feed' ? (l.feedItem?.feedType || '') : '',
          brandSnapshot: l.lineType === 'feed' ? (l.feedItem?.brand || '') : '',
          quantity: l.lineType === 'feed' ? (l.enteredQuantity || 0) : (l.quantity || 0),
          unit: l.lineType === 'feed' ? (l.enteredUnit || 'bags') : (l.unit || 'units'),
          bagWeightKgSnapshot: l.lineType === 'feed' ? (l.bagWeightKg || 25) : 0,
          standardizedGrams: l.lineType === 'feed' ? convertFeedToGrams(l.enteredQuantity || 0, l.enteredUnit || 'bags', l.bagWeightKg || 25) : 0,
          unitPriceNgn: l.unitPriceNgn,
          totalAmountNgn: (l.lineType === 'feed' ? (l.enteredQuantity || 0) : (l.quantity || 0)) * l.unitPriceNgn,
          batchId: l.batch?.id || '',
          batchCodeSnapshot: l.batch?.batchCode || '',
          remarks: l.remarks || '',
        })),
        subtotalNgn: totalAmountNgn,
        totalAmountNgn,
        paidAmountNgn: effectivePaidAmount,
        balanceNgn: balanceDueNgn,
        paymentStatus: effectivePaymentStatus,
        paymentMethod: effectivePaidAmount > 0 ? paymentMethod : '',
        paymentReference,
        remarks: billRemarks.trim(),
        isVoided: false,
        voidReason: '',
        createdBy: member.uid,
        createdByName: member.displayName,
        updatedBy: member.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      onInvoiceCreated(createdInvoice, printImmediately);
    } catch (err) {
      setFormError(formatUserFriendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Back to Purchases"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">New Purchase Bill</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Record a multi-item purchase bill with feed stock-in, medication, equipment, vendor selection, and balance tracking.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSaveInvoice(false)}
            className="rounded-lg border border-emerald-800 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-emerald-800 hover:bg-emerald-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Saving...' : 'Save Bill'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSaveInvoice(true)}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg bg-emerald-800 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-900 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            <span>{submitting ? 'Saving...' : 'Save & Print Voucher'}</span>
          </button>
        </div>
      </div>

      {formError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to save purchase bill</p>
            <p className="mt-0.5 text-xs text-red-700">{formError}</p>
          </div>
        </div>
      )}

      {/* Bill Meta & Vendor Selection */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vendor Selector Card */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Truck className="h-4 w-4 text-emerald-800" />
              <span>Vendor / Supplier <span className="text-red-500">*</span></span>
            </label>
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-900 hover:underline cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>+ Register New Vendor</span>
            </button>
          </div>

          <div className="relative">
            {selectedVendor ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50/60 p-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-emerald-800 p-2 text-white">
                    <UserCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-950">{selectedVendor.name}</p>
                    <p className="text-xs text-emerald-700 font-mono">
                      {selectedVendor.phone || 'No phone'} · {selectedVendor.email || 'No email'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedVendor(null);
                    setVendorSearch('');
                  }}
                  className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-200/60 cursor-pointer"
                  title="Change vendor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search registered vendors by name, phone, or email..."
                    value={vendorSearch}
                    onChange={(e) => {
                      setVendorSearch(e.target.value);
                      setShowVendorDropdown(true);
                    }}
                    onFocus={() => setShowVendorDropdown(true)}
                    className="w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-hidden"
                  />
                </div>

                {/* Combobox Dropdown */}
                {showVendorDropdown && (
                  <div className="absolute top-12 left-0 right-0 z-30 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl divide-y divide-slate-100">
                    {/* One-off Supplier option always at top */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVendor(null);
                        setShowVendorDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-amber-50/70 flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">One-off / Walk-in Supplier</p>
                        <p className="text-xs text-slate-500">Unregistered vendor · Immediate settlement required (No credit)</p>
                      </div>
                      <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">
                        Paid in Full
                      </span>
                    </button>

                    {filteredVendors.map((vend) => (
                      <button
                        key={vend.id}
                        type="button"
                        onClick={() => {
                          setSelectedVendor(vend);
                          setShowVendorDropdown(false);
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{vend.name}</p>
                          <p className="text-xs text-slate-500 font-mono">{vend.phone || 'No phone'}</p>
                        </div>
                        <span className="text-xs font-semibold text-emerald-800">Select</span>
                      </button>
                    ))}

                    {filteredVendors.length === 0 && vendorSearch.trim() && (
                      <div className="p-4 text-center text-xs text-slate-500">
                        No registered vendor matching "{vendorSearch}".
                      </div>
                    )}
                  </div>
                )}

                {/* One-off Supplier Notice */}
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900">
                      <strong className="font-bold">One-off Supplier mode:</strong> Unregistered supplier purchases cannot be placed on credit. Payment is recorded as settled in full.
                    </div>
                  </div>
                  <div>
                    <label htmlFor="oneoff-name" className="block text-[11px] font-semibold text-amber-900">
                      Supplier / Store Name (Optional)
                    </label>
                    <input
                      id="oneoff-name"
                      type="text"
                      placeholder="e.g. Agrovet Depot / Sabo Feed Mill"
                      value={oneOffSupplierName}
                      onChange={(e) => setOneOffSupplierName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-slate-800"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bill Meta Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900">Bill Details</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bill-date" className="block text-xs font-medium text-slate-600">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                id="bill-date"
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label htmlFor="bill-ref" className="block text-xs font-medium text-slate-600">
                Vendor Invoice / Ref #
              </label>
              <input
                id="bill-ref"
                type="text"
                placeholder="e.g. VEND-9821"
                value={billReference}
                onChange={(e) => setBillReference(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="bill-remarks" className="block text-xs font-medium text-slate-600">
              Bill Remarks / Delivery Note
            </label>
            <textarea
              id="bill-remarks"
              rows={2}
              maxLength={500}
              placeholder="e.g. Delivered to Store 2; verified seal on bags"
              value={billRemarks}
              onChange={(e) => setBillRemarks(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Multi-item Line Items */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Purchase Line Items</h2>
            <p className="text-xs text-slate-500">Combine feed stock-in purchases with medications, vaccines, crates, and farm expenses on one bill.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addLine('feed')}
              disabled={activeFeedItems.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Wheat className="h-3.5 w-3.5" />
              <span>+ Add Feed Item</span>
            </button>
            <button
              type="button"
              onClick={() => addLine('general')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <Package className="h-3.5 w-3.5" />
              <span>+ Add Med / Expense</span>
            </button>
          </div>
        </div>

        {/* Mobile Line Cards */}
        <div className="sm:hidden space-y-3">
          {lines.map((line, idx) => {
            const calc = lineCalculations[idx];

            return (
              <div key={line.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">Item #{idx + 1}</span>
                    <select
                      value={line.lineType}
                      onChange={(e) => updateLine(line.id, { lineType: e.target.value as 'feed' | 'general' })}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold"
                    >
                      <option value="feed">Feed Stock</option>
                      <option value="general">Expense</option>
                    </select>
                  </div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="rounded p-1 text-slate-400 hover:text-red-700 hover:bg-red-50"
                      title="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {line.lineType === 'feed' ? (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Feed Item</label>
                    <select
                      value={line.feedItemId}
                      onChange={(e) => updateLine(line.id, { feedItemId: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                    >
                      <option value="">Select feed item...</option>
                      {activeFeedItems.map((fi) => (
                        <option key={fi.id} value={fi.id}>
                          {fi.feedType} ({fi.brand})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Expense / Item Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Oxytetracycline 20%"
                        value={line.itemName}
                        onChange={(e) => updateLine(line.id, { itemName: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Category</label>
                      <select
                        value={line.category}
                        onChange={(e) => updateLine(line.id, { category: e.target.value as PurchaseCategory })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700"
                      >
                        {PURCHASE_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Quantity</label>
                    <input
                      type="number"
                      step={line.lineType === 'feed' ? '0.1' : '1'}
                      min="0.1"
                      value={line.lineType === 'feed' ? line.enteredQuantity : line.quantity}
                      onChange={(e) =>
                        updateLine(line.id, line.lineType === 'feed' ? { enteredQuantity: e.target.value } : { quantity: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Unit</label>
                    {line.lineType === 'feed' ? (
                      <select
                        value={line.enteredUnit}
                        onChange={(e) => updateLine(line.id, { enteredUnit: e.target.value as FeedUnit })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                      >
                        <option value="bags">Bags</option>
                        <option value="kg">Kg</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="e.g. bottle"
                        value={line.unit}
                        onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    {line.lineType === 'feed' ? (
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Bag Weight (kg)</label>
                        <input
                          type="number"
                          step="0.5"
                          min="1"
                          value={line.bagWeightKg}
                          onChange={(e) => updateLine(line.id, { bagWeightKg: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-mono"
                        />
                        {calc.stdKg > 0 && (
                          <span className="text-[10px] text-emerald-800 font-mono block mt-0.5">
                            = {calc.stdKg.toFixed(1)} kg total
                          </span>
                        )}
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Flock (Opt.)</label>
                        <select
                          value={line.selectedBatchId}
                          onChange={(e) => updateLine(line.id, { selectedBatchId: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                        >
                          <option value="">Farm-wide</option>
                          {activeBatches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.batchCode}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Unit Cost (₦)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="₦ 0.00"
                      value={line.unitPriceNgn}
                      onChange={(e) => updateLine(line.id, { unitPriceNgn: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-mono font-semibold"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                  <span className="font-medium text-slate-500">Line Total:</span>
                  <span className="font-mono font-bold text-base text-slate-900">{formatNgn(calc.lineTotal)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 w-28">Type</th>
                <th className="py-2.5 px-3 min-w-48">Item Description</th>
                <th className="py-2.5 px-3 text-center w-24">Qty</th>
                <th className="py-2.5 px-3 text-center w-24">Unit</th>
                <th className="py-2.5 px-3 text-center w-28">Weight / Flock</th>
                <th className="py-2.5 px-3 text-right w-32">Unit Cost (₦)</th>
                <th className="py-2.5 px-3 text-right w-32">Line Total (₦)</th>
                <th className="py-2.5 px-2 text-center w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => {
                const calc = lineCalculations[idx];

                return (
                  <tr key={line.id} className="hover:bg-slate-50/50">
                    {/* Item Type Switcher */}
                    <td className="py-3 px-3 align-top">
                      <select
                        value={line.lineType}
                        onChange={(e) => updateLine(line.id, { lineType: e.target.value as 'feed' | 'general' })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold"
                      >
                        <option value="feed">Feed Stock</option>
                        <option value="general">Expense</option>
                      </select>
                    </td>

                    {/* Item Description / Selector */}
                    <td className="py-3 px-3 align-top">
                      {line.lineType === 'feed' ? (
                        <div>
                          <select
                            value={line.feedItemId}
                            onChange={(e) => updateLine(line.id, { feedItemId: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="">Select feed item...</option>
                            {activeFeedItems.map((fi) => (
                              <option key={fi.id} value={fi.id}>
                                {fi.feedType} ({fi.brand})
                              </option>
                            ))}
                          </select>
                          {calc.feedItem && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Increments feed store balance automatically upon saving.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            placeholder="Expense / item name (e.g. Oxytetracycline 20%)"
                            value={line.itemName}
                            onChange={(e) => updateLine(line.id, { itemName: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                          />
                          <select
                            value={line.category}
                            onChange={(e) => updateLine(line.id, { category: e.target.value as PurchaseCategory })}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600"
                          >
                            {PURCHASE_CATEGORIES.map((cat) => (
                              <option key={cat.value} value={cat.value}>
                                {cat.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>

                    {/* Quantity */}
                    <td className="py-3 px-3 align-top text-center">
                      <input
                        type="number"
                        step={line.lineType === 'feed' ? '0.1' : '1'}
                        min="0.1"
                        value={line.lineType === 'feed' ? line.enteredQuantity : line.quantity}
                        onChange={(e) =>
                          updateLine(line.id, line.lineType === 'feed' ? { enteredQuantity: e.target.value } : { quantity: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-center font-mono font-bold"
                      />
                    </td>

                    {/* Unit */}
                    <td className="py-3 px-3 align-top text-center">
                      {line.lineType === 'feed' ? (
                        <select
                          value={line.enteredUnit}
                          onChange={(e) => updateLine(line.id, { enteredUnit: e.target.value as FeedUnit })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        >
                          <option value="bags">Bags</option>
                          <option value="kg">Kg</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="e.g. bottle"
                          value={line.unit}
                          onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-center"
                        />
                      )}
                    </td>

                    {/* Weight (Feed) or Flock Batch (General) */}
                    <td className="py-3 px-3 align-top text-center">
                      {line.lineType === 'feed' ? (
                        <div>
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              step="0.5"
                              min="1"
                              value={line.bagWeightKg}
                              onChange={(e) => updateLine(line.id, { bagWeightKg: e.target.value })}
                              className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs text-center font-mono"
                            />
                            <span className="text-[11px] text-slate-500">kg/bag</span>
                          </div>
                          {calc.stdKg > 0 && (
                            <span className="text-[10px] text-emerald-800 font-mono block mt-0.5">
                              {calc.stdKg.toFixed(1)} kg total
                            </span>
                          )}
                        </div>
                      ) : (
                        <select
                          value={line.selectedBatchId}
                          onChange={(e) => updateLine(line.id, { selectedBatchId: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-[11px]"
                        >
                          <option value="">Farm-wide</option>
                          {activeBatches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.batchCode}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Unit Price */}
                    <td className="py-3 px-3 align-top text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="₦ 0.00"
                        value={line.unitPriceNgn}
                        onChange={(e) => updateLine(line.id, { unitPriceNgn: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-right font-mono font-semibold"
                      />
                    </td>

                    {/* Line Total */}
                    <td className="py-3 px-3 align-top text-right font-mono font-bold text-slate-900">
                      {formatNgn(calc.lineTotal)}
                    </td>

                    {/* Delete Line */}
                    <td className="py-3 px-2 align-top text-center">
                      <button
                        type="button"
                        disabled={lines.length <= 1}
                        onClick={() => removeLine(line.id)}
                        className="rounded p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-30 cursor-pointer"
                        title="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill Totals & Payment Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Confirmation Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900">Payment & Settlement</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="bill-payment-status" className="block text-xs font-medium text-slate-600">
                Payment Status <span className="text-red-500">*</span>
              </label>
              <select
                id="bill-payment-status"
                disabled={isOneOff}
                value={effectivePaymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as InvoicePaymentStatus)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:bg-slate-100"
              >
                <option value="paid">Paid in Full</option>
                <option value="partial">Partial Payment</option>
                <option value="unpaid">Unpaid (Vendor Bill / Credit)</option>
              </select>
              {isOneOff && (
                <p className="mt-1 text-[11px] text-amber-700">
                  One-off suppliers are locked to immediate full payment.
                </p>
              )}
            </div>

            {effectivePaymentStatus !== 'unpaid' && (
              <div>
                <label htmlFor="bill-payment-method" className="block text-xs font-medium text-slate-600">
                  Payment Method <span className="text-red-500">*</span>
                </label>
                <select
                  id="bill-payment-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as AccountPaymentMethod)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                  {PAYMENT_METHODS.map((pm) => (
                    <option key={pm.value} value={pm.value}>
                      {pm.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {effectivePaymentStatus === 'partial' && (
            <div>
              <label htmlFor="bill-amount-paid" className="block text-xs font-medium text-slate-600">
                Amount Paid Today (₦) <span className="text-red-500">*</span>
              </label>
              <input
                id="bill-amount-paid"
                type="number"
                step="0.01"
                min="0.01"
                max={totalAmountNgn}
                placeholder="Enter partial deposit amount"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold"
              />
            </div>
          )}

          {effectivePaymentStatus !== 'unpaid' && (
            <div>
              <label htmlFor="bill-payment-ref" className="block text-xs font-medium text-slate-600">
                Payment Reference / Transaction ID
              </label>
              <input
                id="bill-payment-ref"
                type="text"
                placeholder="e.g. TRF-10294828 / POS Auth #9932"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>
          )}
        </div>

        {/* Financial Summary Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">Bill Summary</h2>

          <div className="flex justify-between items-center text-sm text-slate-600">
            <span>Bill Subtotal:</span>
            <span className="font-mono font-bold text-slate-900 text-base">{formatNgn(totalAmountNgn)}</span>
          </div>

          <div className="flex justify-between items-center text-sm font-bold text-slate-900 border-t border-slate-200 pt-3">
            <span>Total Bill Amount:</span>
            <span className="font-mono text-xl text-emerald-900 font-extrabold">{formatNgn(totalAmountNgn)}</span>
          </div>

          <div className="flex justify-between items-center text-xs text-slate-600 pt-1">
            <span>Amount Paid:</span>
            <span className="font-mono font-semibold text-emerald-700">{formatNgn(effectivePaidAmount)}</span>
          </div>

          <div className={`flex justify-between items-center font-bold border-t border-slate-200 pt-3 ${balanceDueNgn > 0 ? 'text-red-700' : 'text-slate-600'}`}>
            <span className="text-sm">Balance Due to Vendor:</span>
            <span className="font-mono text-lg font-bold">{formatNgn(balanceDueNgn)}</span>
          </div>

          {selectedVendor && balanceDueNgn > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 rounded-lg p-2.5 border border-amber-200 mt-2">
              An outstanding accounts payable balance of <strong>{formatNgn(balanceDueNgn)}</strong> will be credited to {selectedVendor.name}'s account and shown on vendor balance statements.
            </p>
          )}
        </div>
      </div>

      {/* Mobile Sticky Bottom Submit Bar */}
      <div className="sm:hidden flex items-center gap-2 pt-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() => handleSaveInvoice(false)}
          className="flex-1 rounded-xl border border-emerald-800 bg-white py-3 text-xs font-bold text-emerald-800 shadow-xs disabled:opacity-50"
        >
          {submitting ? 'Saving...' : 'Save Bill'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => handleSaveInvoice(true)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-800 py-3 text-xs font-bold text-white shadow-xs disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          <span>{submitting ? 'Saving...' : 'Save & Print'}</span>
        </button>
      </div>

      {/* Quick Add Vendor Modal */}
      {quickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Truck className="h-4 w-4 text-emerald-800" />
                <span>Register New Vendor / Supplier</span>
              </h3>
              <button
                type="button"
                onClick={() => setQuickAddOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleQuickAddVendor} className="mt-4 space-y-4">
              {quickAddError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  {quickAddError}
                </div>
              )}

              <div>
                <label htmlFor="new-vend-name" className="block text-xs font-semibold text-slate-700">
                  Vendor / Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="new-vend-name"
                  type="text"
                  required
                  placeholder="e.g. Livestock Feeds Plc / Agrovet Store"
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="new-vend-phone" className="block text-xs font-semibold text-slate-700">
                  Phone Number
                </label>
                <input
                  id="new-vend-phone"
                  type="tel"
                  placeholder="e.g. 08012345678"
                  value={newVendorPhone}
                  onChange={(e) => setNewVendorPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="new-vend-email" className="block text-xs font-semibold text-slate-700">
                  Email Address
                </label>
                <input
                  id="new-vend-email"
                  type="email"
                  placeholder="e.g. sales@feedvendor.com"
                  value={newVendorEmail}
                  onChange={(e) => setNewVendorEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={quickAddBusy}
                  className="rounded-lg bg-emerald-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50 cursor-pointer"
                >
                  {quickAddBusy ? 'Saving...' : 'Register Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
