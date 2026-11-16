import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  DollarSign,
  Info,
  Plus,
  Printer,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  formatDateInTimezone,
  formatNgn,
  hasPermission,
} from '../domain/calculations.ts';
import { formatEggQuantity } from '../domain/eggStore.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { createSalesInvoice, saveParty } from '../services/accountsService.ts';
import type {
  AccountPaymentMethod,
  Customer,
  InvoicePaymentStatus,
  SalesInvoice,
} from '../types/accounts.ts';
import type {
  Farm,
  FarmMember,
  PoultryBatch,
  SalesUnit,
} from '../types/farm.ts';
import type {
  EggInventoryBalance,
  EggStoreSettings,
} from '../types/eggStore.ts';

interface LineItemDraft {
  id: string;
  salesUnitId: string;
  eggCategory: string;
  quantity: string;
  unitPriceNgn: string;
  overrideReason: string;
  selectedBatchId: string;
  selectedBalanceId: string;
  remarks: string;
}

interface Props {
  farm: Farm;
  member: FarmMember;
  customers: Customer[];
  salesUnits: SalesUnit[];
  batches: PoultryBatch[];
  eggStoreSettings: EggStoreSettings | null;
  inventoryBalances: EggInventoryBalance[];
  onCancel: () => void;
  onInvoiceCreated: (invoice: SalesInvoice, printImmediately: boolean) => void;
}

const PAYMENT_METHODS: { value: AccountPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'pos', label: 'POS Terminal' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export const SalesInvoiceCreator: React.FC<Props> = ({
  farm,
  member,
  customers,
  salesUnits,
  batches,
  eggStoreSettings,
  inventoryBalances,
  onCancel,
  onInvoiceCreated,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const activeUnits = useMemo(() => salesUnits.filter((u) => u.status === 'active'), [salesUnits]);
  const unitById = useMemo(() => new Map(salesUnits.map((u) => [u.id, u])), [salesUnits]);
  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const activeCustomers = useMemo(() => customers.filter((c) => c.status === 'active'), [customers]);
  const trueInventoryMode = eggStoreSettings?.salesMode === 'true_inventory';
  const availableBalances = useMemo(() => inventoryBalances.filter((b) => b.balanceEggs > 0), [inventoryBalances]);
  const canOverridePrice = hasPermission(member, 'sales', 'overridePrice');

  // Customer selection: null means Walk-in Customer
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Quick Add Customer modal
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');

  // Invoice Fields
  const [txDate, setTxDate] = useState(todayStr);
  const [txTime, setTxTime] = useState(new Date().toTimeString().slice(0, 5));
  const [invoiceRemarks, setInvoiceRemarks] = useState('');
  const [discountNgn, setDiscountNgn] = useState('0');

  // Payment Fields
  const [paymentStatus, setPaymentStatus] = useState<InvoicePaymentStatus>('paid');
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<AccountPaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');

  // Multi-line Items
  const createBlankLine = (): LineItemDraft => {
    const defaultUnit = activeUnits[0];
    return {
      id: Math.random().toString(36).slice(2, 9),
      salesUnitId: defaultUnit?.id || '',
      eggCategory: 'Standard Brown',
      quantity: '1',
      unitPriceNgn: String(defaultUnit?.currentPriceNgn || 0),
      overrideReason: '',
      selectedBatchId: '',
      selectedBalanceId: '',
      remarks: '',
    };
  };

  const [lines, setLines] = useState<LineItemDraft[]>([createBlankLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filtered customer list for combobox
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return activeCustomers;
    return activeCustomers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [activeCustomers, customerSearch]);

  const addLine = () => {
    setLines((prev) => [...prev, createBlankLine()]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, patch: Partial<LineItemDraft>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, ...patch };
        if (patch.salesUnitId && patch.salesUnitId !== l.salesUnitId) {
          const u = unitById.get(patch.salesUnitId);
          if (u) updated.unitPriceNgn = String(u.currentPriceNgn);
        }
        return updated;
      })
    );
  };

  // Financial Calculations
  const lineCalculations = useMemo(() => {
    return lines.map((line) => {
      const unit = unitById.get(line.salesUnitId);
      const qty = Number(line.quantity) || 0;
      const price = Number(line.unitPriceNgn) || 0;
      const eggsPerUnit = unit?.eggCountPerUnit || 30;
      const totalEggs = Math.round(qty * eggsPerUnit);
      const lineTotal = Math.round(qty * price * 100) / 100;
      const suggestedPrice = unit?.currentPriceNgn ?? 0;
      const isPriceOverridden = Math.abs(price - suggestedPrice) > 0.001;

      return {
        unit,
        qty,
        price,
        eggsPerUnit,
        totalEggs,
        lineTotal,
        suggestedPrice,
        isPriceOverridden,
      };
    });
  }, [lines, unitById]);

  const subtotalNgn = useMemo(() => {
    return lineCalculations.reduce((sum, item) => sum + item.lineTotal, 0);
  }, [lineCalculations]);

  const numericDiscount = Number(discountNgn) || 0;
  const totalAmountNgn = Math.max(0, Math.round((subtotalNgn - numericDiscount) * 100) / 100);

  // Walk-in forces paymentStatus = 'paid'
  const isWalkIn = !selectedCustomer;
  const effectivePaymentStatus: InvoicePaymentStatus = isWalkIn ? 'paid' : paymentStatus;

  const effectivePaidAmount = useMemo(() => {
    if (effectivePaymentStatus === 'paid') return totalAmountNgn;
    if (effectivePaymentStatus === 'unpaid') return 0;
    return Math.max(0, Math.min(totalAmountNgn, Number(amountPaid) || 0));
  }, [effectivePaymentStatus, totalAmountNgn, amountPaid]);

  const balanceDueNgn = Math.max(0, Math.round((totalAmountNgn - effectivePaidAmount) * 100) / 100);

  // Quick Customer Creation
  const handleQuickAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) {
      setQuickAddError('Enter a customer name.');
      return;
    }
    setQuickAddBusy(true);
    setQuickAddError('');
    try {
      const id = await saveParty({
        farmId: farm.farmId,
        kind: 'customer',
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        email: newCustEmail.trim(),
        address: '',
        notes: 'Created during invoice creation',
        openingBalanceNgn: 0,
        openingBalanceDate: todayStr,
        actorUid: member.uid,
      });

      const newCust: Customer = {
        id,
        farmId: farm.farmId,
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        email: newCustEmail.trim(),
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

      setSelectedCustomer(newCust);
      setQuickAddOpen(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustEmail('');
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
      if (lines.length === 0) throw new Error('Add at least one line item.');

      // Check for price overrides without reasons
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const calc = lineCalculations[i];
        if (calc.qty <= 0) throw new Error(`Line ${i + 1}: Quantity must be greater than zero.`);
        if (calc.isPriceOverridden) {
          if (!canOverridePrice) {
            throw new Error(`Line ${i + 1}: You do not have permission to override the unit price.`);
          }
          if (!line.overrideReason.trim()) {
            throw new Error(`Line ${i + 1}: Please provide a reason for the price override.`);
          }
        }
        if (trueInventoryMode && !line.selectedBalanceId) {
          throw new Error(`Line ${i + 1}: Select an available stock lot for True-inventory deduction.`);
        }
      }

      if (effectivePaymentStatus === 'partial' && effectivePaidAmount <= 0) {
        throw new Error('Enter a partial amount paid greater than zero.');
      }

      const invoiceLinesPayload = lines.map((l, idx) => {
        const calc = lineCalculations[idx];
        const selectedBatch = l.selectedBatchId ? batches.find((b) => b.id === l.selectedBatchId) || null : null;
        const selectedBalance = l.selectedBalanceId ? inventoryBalances.find((b) => b.id === l.selectedBalanceId) || null : null;

        return {
          salesUnit: calc.unit!,
          eggCategory: l.eggCategory,
          quantity: calc.qty,
          unitPriceNgn: calc.price,
          suggestedUnitPriceNgn: calc.suggestedPrice,
          priceOverridden: calc.isPriceOverridden,
          overrideReason: l.overrideReason,
          batch: selectedBatch,
          stockLot: selectedBalance,
          remarks: l.remarks,
        };
      });

      const invoiceId = await createSalesInvoice({
        farmId: farm.farmId,
        transactionDate: txDate,
        transactionTime: txTime,
        customer: selectedCustomer,
        walkInCustomerName: walkInName,
        lines: invoiceLinesPayload,
        discountNgn: numericDiscount,
        paymentStatus: effectivePaymentStatus,
        paymentMethod: effectivePaidAmount > 0 ? paymentMethod : '',
        paymentReference,
        amountPaidNgn: effectivePaidAmount,
        remarks: invoiceRemarks,
        salesMode: trueInventoryMode ? 'true_inventory' : 'phantom',
        eggStoreSettings,
        actor: member,
      });

      // Construct dummy object for immediate preview
      const createdInvoice: SalesInvoice = {
        id: invoiceId,
        farmId: farm.farmId,
        invoiceNumber: `INV-${txDate.replace(/-/g, '').slice(2, 6)}-${invoiceId.slice(-4).toUpperCase()}`,
        transactionDate: txDate,
        transactionTime: txTime,
        customerId: selectedCustomer ? selectedCustomer.id : 'walk-in',
        customerNameSnapshot: selectedCustomer ? selectedCustomer.name : (walkInName.trim() || 'Walk-in Customer'),
        lines: invoiceLinesPayload.map((l, index) => ({
          id: `line-${index}`,
          eggSaleId: `sale-${index}`,
          grade: l.eggCategory,
          eggCategory: l.eggCategory,
          salesUnitId: l.salesUnit.id,
          unitNameSnapshot: l.salesUnit.name,
          eggsPerUnitSnapshot: l.salesUnit.eggCountPerUnit,
          quantity: l.quantity,
          totalEggs: l.quantity * l.salesUnit.eggCountPerUnit,
          unitPriceNgn: l.unitPriceNgn,
          discountNgn: 0,
          totalAmountNgn: l.quantity * l.unitPriceNgn,
          suggestedUnitPriceNgn: l.suggestedUnitPriceNgn,
          priceOverridden: l.priceOverridden,
          overrideReason: l.overrideReason || '',
          batchId: l.batch?.id || '',
          batchCodeSnapshot: l.batch?.batchCode || '',
          sourcePenId: '',
          sourcePenNameSnapshot: '',
          remarks: l.remarks || '',
        })),
        subtotalNgn,
        discountNgn: numericDiscount,
        totalAmountNgn,
        paidAmountNgn: effectivePaidAmount,
        balanceNgn: balanceDueNgn,
        paymentStatus: effectivePaymentStatus,
        salesMode: trueInventoryMode ? 'true_inventory' : 'phantom',
        paymentMethod: effectivePaidAmount > 0 ? paymentMethod : '',
        paymentReference,
        remarks: invoiceRemarks,
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
            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-100 transition-colors"
            title="Back to Sales"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">New Sales Invoice</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Create a multi-product egg sales invoice with customer selection, credit management, and instant receipt printing.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSaveInvoice(false)}
            className="rounded-lg border border-emerald-800 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-emerald-800 hover:bg-emerald-50 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save Invoice'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSaveInvoice(true)}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg bg-emerald-800 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-900 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            <span>{submitting ? 'Saving...' : 'Save & Print Receipt'}</span>
          </button>
        </div>
      </div>

      {formError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to generate invoice</p>
            <p className="mt-0.5 text-xs text-red-700">{formError}</p>
          </div>
        </div>
      )}

      {/* Invoice Meta & Customer Selection */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer Selector Card */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-800" />
              <span>Customer Selection <span className="text-red-500">*</span></span>
            </label>
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-900 hover:underline"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>+ Register New Customer</span>
            </button>
          </div>

          <div className="relative">
            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50/60 p-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-emerald-800 p-2 text-white">
                    <UserCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-950">{selectedCustomer.name}</p>
                    <p className="text-xs text-emerald-700 font-mono">
                      {selectedCustomer.phone || 'No phone'} · {selectedCustomer.email || 'No email'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCustomerSearch('');
                  }}
                  className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-200/60"
                  title="Change customer"
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
                    placeholder="Search registered customers by name, phone, or email..."
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    className="w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-hidden"
                  />
                </div>

                {/* Combobox Dropdown */}
                {showCustomerDropdown && (
                  <div className="absolute top-12 left-0 right-0 z-30 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl divide-y divide-slate-100">
                    {/* Walk-in option always at top */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setShowCustomerDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-amber-50/70 flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">Walk-in Customer</p>
                        <p className="text-xs text-slate-500">Unregistered buyer · Immediate payment required (No credit)</p>
                      </div>
                      <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">
                        Immediate Pay
                      </span>
                    </button>

                    {filteredCustomers.map((cust) => (
                      <button
                        key={cust.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(cust);
                          setShowCustomerDropdown(false);
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{cust.name}</p>
                          <p className="text-xs text-slate-500 font-mono">{cust.phone || 'No phone'}</p>
                        </div>
                        <span className="text-xs font-semibold text-emerald-800">Select</span>
                      </button>
                    ))}

                    {filteredCustomers.length === 0 && customerSearch.trim() && (
                      <div className="p-4 text-center text-xs text-slate-500">
                        No registered customer matching "{customerSearch}".
                      </div>
                    )}
                  </div>
                )}

                {/* Walk-in Customer Selected Notice & Name Note */}
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900">
                      <strong className="font-bold">Walk-in Customer mode:</strong> Unregistered customer transactions cannot be sold on credit. Payment must be confirmed in full before completing this sale.
                    </div>
                  </div>
                  <div>
                    <label htmlFor="walkin-name" className="block text-[11px] font-semibold text-amber-900">
                      Walk-in Customer Reference / Name (Optional)
                    </label>
                    <input
                      id="walkin-name"
                      type="text"
                      placeholder="e.g. Alhaji Danladi / Market Buyer"
                      value={walkInName}
                      onChange={(e) => setWalkInName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-slate-800"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Invoice Date & Time Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900">Invoice Information</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-date" className="block text-xs font-medium text-slate-600">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                id="inv-date"
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label htmlFor="inv-time" className="block text-xs font-medium text-slate-600">
                Time
              </label>
              <input
                id="inv-time"
                type="time"
                value={txTime}
                onChange={(e) => setTxTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="inv-remarks" className="block text-xs font-medium text-slate-600">
              Invoice Remarks / Delivery Note
            </label>
            <textarea
              id="inv-remarks"
              rows={2}
              maxLength={500}
              placeholder="e.g. Delivered to central egg depot; gate pass issued"
              value={invoiceRemarks}
              onChange={(e) => setInvoiceRemarks(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Product Line Items */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Products & Egg Quantities</h2>
            <p className="text-xs text-slate-500">Add multiple egg categories, crate sizes, and quantities to this single invoice.</p>
          </div>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>+ Add Product Line</span>
          </button>
        </div>

        {/* Mobile Product Line Cards */}
        <div className="sm:hidden space-y-3">
          {lines.map((line, idx) => {
            const calc = lineCalculations[idx];
            return (
              <div key={line.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                  <span className="text-xs font-bold text-slate-800">Product Item #{idx + 1}</span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="rounded p-1 text-slate-400 hover:text-red-700 hover:bg-red-50"
                      title="Remove product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Selling Unit</label>
                  <select
                    value={line.salesUnitId}
                    onChange={(e) => updateLine(line.id, { salesUnitId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                  >
                    {activeUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.eggCountPerUnit} eggs) — {formatNgn(u.currentPriceNgn)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Grade / Category</label>
                    <input
                      type="text"
                      value={line.eggCategory}
                      onChange={(e) => updateLine(line.id, { eggCategory: e.target.value })}
                      placeholder="e.g. Standard"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Flock (Opt.)</label>
                    <select
                      value={line.selectedBatchId}
                      onChange={(e) => updateLine(line.id, { selectedBatchId: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                    >
                      <option value="">Pooled</option>
                      {activeBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.batchCode}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {trueInventoryMode && (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Stock Lot</label>
                    <select
                      value={line.selectedBalanceId}
                      onChange={(e) => {
                        const next = e.target.value;
                        const bal = availableBalances.find((b) => b.id === next);
                        updateLine(line.id, {
                          selectedBalanceId: next,
                          eggCategory: bal ? bal.category : line.eggCategory,
                        });
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                    >
                      <option value="">Select available lot...</option>
                      {availableBalances.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.category} · {b.sourcePenNameSnapshot || 'Pooled'} ({formatEggQuantity(b.balanceEggs)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Quantity</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-mono font-bold"
                    />
                    <span className="block text-[10px] text-slate-500 font-mono mt-0.5">
                      = {calc.totalEggs.toLocaleString()} eggs
                    </span>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Unit Price (₦)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={!canOverridePrice}
                      value={line.unitPriceNgn}
                      onChange={(e) => updateLine(line.id, { unitPriceNgn: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-mono disabled:bg-slate-100"
                    />
                  </div>
                </div>

                {calc.isPriceOverridden && (
                  <div>
                    <label className="block text-[10px] text-amber-800 font-medium mb-1">Override Reason</label>
                    <input
                      type="text"
                      required
                      placeholder="Reason for price change"
                      value={line.overrideReason}
                      onChange={(e) => updateLine(line.id, { overrideReason: e.target.value })}
                      className="w-full rounded-lg border border-amber-300 bg-amber-50/50 px-2.5 py-1.5 text-xs text-amber-900"
                    />
                  </div>
                )}

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
                <th className="py-2.5 px-3">Selling Unit</th>
                <th className="py-2.5 px-3">Grade / Category</th>
                {trueInventoryMode && <th className="py-2.5 px-3">Stock Lot</th>}
                <th className="py-2.5 px-3">Flock (Opt.)</th>
                <th className="py-2.5 px-3 text-center w-24">Qty</th>
                <th className="py-2.5 px-3 text-center w-28">Total Eggs</th>
                <th className="py-2.5 px-3 text-right w-32">Unit Price (₦)</th>
                <th className="py-2.5 px-3 text-right w-32">Total (₦)</th>
                <th className="py-2.5 px-2 text-center w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => {
                const calc = lineCalculations[idx];

                return (
                  <tr key={line.id} className="hover:bg-slate-50/50">
                    {/* Unit Selector */}
                    <td className="py-3 px-3 align-top min-w-44">
                      <select
                        value={line.salesUnitId}
                        onChange={(e) => updateLine(line.id, { salesUnitId: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        {activeUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.eggCountPerUnit} eggs) — {formatNgn(u.currentPriceNgn)}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Category / Grade */}
                    <td className="py-3 px-3 align-top min-w-36">
                      <input
                        type="text"
                        value={line.eggCategory}
                        onChange={(e) => updateLine(line.id, { eggCategory: e.target.value })}
                        placeholder="e.g. Jumbo / Medium"
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                    </td>

                    {/* Stock Lot in True Inventory Mode */}
                    {trueInventoryMode && (
                      <td className="py-3 px-3 align-top min-w-48">
                        <select
                          value={line.selectedBalanceId}
                          onChange={(e) => {
                            const next = e.target.value;
                            const bal = availableBalances.find((b) => b.id === next);
                            updateLine(line.id, {
                              selectedBalanceId: next,
                              eggCategory: bal ? bal.category : line.eggCategory,
                            });
                          }}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <option value="">Select available lot...</option>
                          {availableBalances.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.category} · {b.sourcePenNameSnapshot || 'Pooled'} ({formatEggQuantity(b.balanceEggs)})
                            </option>
                          ))}
                        </select>
                      </td>
                    )}

                    {/* Flock Attribution */}
                    <td className="py-3 px-3 align-top min-w-36">
                      <select
                        value={line.selectedBatchId}
                        onChange={(e) => updateLine(line.id, { selectedBatchId: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="">Pooled</option>
                        {activeBatches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.batchCode}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Quantity */}
                    <td className="py-3 px-3 align-top text-center">
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-center font-mono font-bold"
                      />
                    </td>

                    {/* Eggs Equivalent */}
                    <td className="py-3 px-3 align-top text-center font-mono text-slate-700">
                      <span className="font-bold">{calc.totalEggs.toLocaleString()}</span>
                      <span className="text-[10px] text-slate-400 block">eggs</span>
                    </td>

                    {/* Unit Price & Override */}
                    <td className="py-3 px-3 align-top text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={!canOverridePrice}
                        value={line.unitPriceNgn}
                        onChange={(e) => updateLine(line.id, { unitPriceNgn: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-right font-mono disabled:bg-slate-100"
                      />
                      {calc.isPriceOverridden && (
                        <input
                          type="text"
                          required
                          placeholder="Override reason"
                          value={line.overrideReason}
                          onChange={(e) => updateLine(line.id, { overrideReason: e.target.value })}
                          className="mt-1 w-full rounded border border-amber-300 bg-amber-50/50 px-1.5 py-0.5 text-[10px] text-amber-900"
                        />
                      )}
                    </td>

                    {/* Line Total */}
                    <td className="py-3 px-3 align-top text-right font-mono font-bold text-slate-900">
                      {formatNgn(calc.lineTotal)}
                    </td>

                    {/* Trash Button */}
                    <td className="py-3 px-2 align-top text-center">
                      <button
                        type="button"
                        disabled={lines.length <= 1}
                        onClick={() => removeLine(line.id)}
                        className="rounded p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-30"
                        title="Remove product"
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

      {/* Bottom Grid: Payment Terms & Totals Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Terms & Method Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-800" />
              <span>Payment Terms & Settlement</span>
            </h2>
            {isWalkIn && (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                Credit Disabled for Walk-in
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pay-status" className="block text-xs font-medium text-slate-600">
                Payment Status <span className="text-red-500">*</span>
              </label>
              <select
                id="pay-status"
                disabled={isWalkIn}
                value={effectivePaymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as InvoicePaymentStatus)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="paid">Paid in Full (Immediate)</option>
                <option value="partial">Partial Payment (Deposit)</option>
                <option value="unpaid">Unpaid / On Credit (Pay Later)</option>
              </select>
              {isWalkIn && (
                <p className="mt-1 text-[11px] text-amber-700">
                  Walk-in buyers must settle payments at time of sale.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="pay-method" className="block text-xs font-medium text-slate-600">
                Payment Method {effectivePaidAmount > 0 && <span className="text-red-500">*</span>}
              </label>
              <select
                id="pay-method"
                disabled={effectivePaymentStatus === 'unpaid'}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as AccountPaymentMethod)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:bg-slate-100"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {effectivePaymentStatus === 'partial' && (
            <div>
              <label htmlFor="partial-amount" className="block text-xs font-medium text-slate-600">
                Amount Paid Now (₦) <span className="text-red-500">*</span>
              </label>
              <input
                id="partial-amount"
                type="number"
                step="0.01"
                min="1"
                max={totalAmountNgn}
                required
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder="Enter deposit / partial amount"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold"
              />
            </div>
          )}

          {effectivePaidAmount > 0 && (
            <div>
              <label htmlFor="pay-ref" className="block text-xs font-medium text-slate-600">
                Payment Reference / Slip No. (Optional)
              </label>
              <input
                id="pay-ref"
                type="text"
                maxLength={80}
                placeholder="e.g. POS Ref: 98124 / FirstBank Transfer"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>
          )}
        </div>

        {/* Totals & Calculations Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">Financial Breakdown</h2>

          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>Subtotal ({lines.length} {lines.length === 1 ? 'item' : 'items'}):</span>
            <span className="font-mono font-semibold text-slate-900">{formatNgn(subtotalNgn)}</span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>Discount (₦):</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={discountNgn}
              onChange={(e) => setDiscountNgn(e.target.value)}
              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs text-right font-mono"
            />
          </div>

          <div className="flex items-center justify-between text-sm font-bold border-t border-slate-200 pt-3 text-slate-900">
            <span>Grand Total:</span>
            <span className="font-mono text-lg text-emerald-900">{formatNgn(totalAmountNgn)}</span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-700">
            <span>Amount Paid Now:</span>
            <span className="font-mono font-bold text-emerald-800">{formatNgn(effectivePaidAmount)}</span>
          </div>

          <div className={`flex items-center justify-between border-t border-slate-200 pt-2 font-bold ${balanceDueNgn > 0 ? 'text-red-700' : 'text-slate-500'}`}>
            <span>Remaining Balance Due:</span>
            <span className="font-mono text-sm">{formatNgn(balanceDueNgn)}</span>
          </div>

          {selectedCustomer && balanceDueNgn > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-lg">
              ₦{balanceDueNgn.toLocaleString()} will be charged as accounts receivable to <strong>{selectedCustomer.name}</strong> and recorded on their account statement.
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
          {submitting ? 'Saving...' : 'Save Invoice'}
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

      {/* Quick Add Customer Modal */}
      {quickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-xl bg-white p-5 sm:p-6 shadow-xl border border-slate-200 space-y-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">Register New Customer</h3>
              <button
                type="button"
                onClick={() => setQuickAddOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {quickAddError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {quickAddError}
              </div>
            )}

            <form onSubmit={handleQuickAddCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Full Customer Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alhaji Garba Shehu"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Phone Number</label>
                <input
                  type="tel"
                  placeholder="e.g. 08031234567"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Email Address (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. customer@example.com"
                  value={newCustEmail}
                  onChange={(e) => setNewCustEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={quickAddBusy}
                  className="rounded-lg bg-emerald-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
                >
                  {quickAddBusy ? 'Saving...' : 'Add & Select'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
