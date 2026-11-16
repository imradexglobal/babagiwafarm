import React, { useMemo, useState } from 'react';
import {
  Ban,
  Clock,
  Edit2,
  FileSpreadsheet,
  FileText,
  Plus,
  Printer,
  Receipt,
  Search,
  UserCheck,
  X,
} from 'lucide-react';
import {
  formatDateInTimezone,
  formatIsoDateDisplay,
  formatNgn,
  hasPermission,
} from '../domain/calculations.ts';
import { formatEggQuantity } from '../domain/eggStore.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { voidSalesInvoice } from '../services/accountsService.ts';
import { updateEggSale, voidEggSale } from '../services/salesService.ts';
import type { Customer, SalesInvoice } from '../types/accounts.ts';
import type { EggInventoryBalance, EggStoreSettings } from '../types/eggStore.ts';
import type {
  EggSale,
  Farm,
  FarmMember,
  PaymentStatus,
  PoultryBatch,
  SalesUnit,
} from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';
import { InvoicePrintDocument } from './InvoicePrintDocument.tsx';
import { SalesInvoiceCreator } from './SalesInvoiceCreator.tsx';

interface SalesViewProps {
  farm: Farm;
  member: FarmMember;
  batches: PoultryBatch[];
  salesUnits: SalesUnit[];
  sales: EggSale[];
  customers: Customer[];
  salesInvoices: SalesInvoice[];
  eggStoreSettings: EggStoreSettings | null;
  inventoryBalances: EggInventoryBalance[];
}

export const SalesView: React.FC<SalesViewProps> = ({
  farm,
  member,
  batches,
  salesUnits,
  sales,
  customers,
  salesInvoices,
  eggStoreSettings,
  inventoryBalances,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canCreate = hasPermission(member, 'sales', 'create');
  const canEdit = hasPermission(member, 'sales', 'edit');
  const canDelete = hasPermission(member, 'sales', 'delete');
  const canOverridePrice = hasPermission(member, 'sales', 'overridePrice');

  const activeUnits = useMemo(() => salesUnits.filter((u) => u.status === 'active'), [salesUnits]);
  const unitById = useMemo(() => new Map(salesUnits.map((u) => [u.id, u])), [salesUnits]);
  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const activeCustomers = useMemo(() => customers.filter((c) => c.status === 'active'), [customers]);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const trueInventoryMode = eggStoreSettings?.salesMode === 'true_inventory';

  // View mode: 'list' | 'create' | 'print'
  const [viewMode, setViewMode] = useState<'list' | 'create' | 'print'>('list');
  const [activePrintInvoice, setActivePrintInvoice] = useState<SalesInvoice | null>(null);

  // Sub-tab: 'invoices' | 'items'
  const [salesTab, setSalesTab] = useState<'invoices' | 'items'>('invoices');

  // Filters
  const [startDate, setStartDate] = useState(`${todayStr.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(todayStr);
  const [showVoided, setShowVoided] = useState(false);
  const [customerFilter, setCustomerFilter] = useState('');

  // Modals & Feedback
  const [editingSale, setEditingSale] = useState<EggSale | null>(null);
  const [voidTarget, setVoidTarget] = useState<EggSale | null>(null);
  const [voidInvoiceTarget, setVoidInvoiceTarget] = useState<SalesInvoice | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit Single Sale Modal State
  const [editTxDate, setEditTxDate] = useState(todayStr);
  const [editTxTime, setEditTxTime] = useState('');
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerId, setEditCustomerId] = useState('');
  const [editEggCategory, setEditEggCategory] = useState('Standard Brown');
  const [editQuantity, setEditQuantity] = useState('1');
  const [editUnitPriceNgn, setEditUnitPriceNgn] = useState('0');
  const [editOverrideReason, setEditOverrideReason] = useState('');
  const [editPaymentStatus, setEditPaymentStatus] = useState<PaymentStatus>('paid');
  const [editSelectedBatchId, setEditSelectedBatchId] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editFormError, setEditFormError] = useState<string | null>(null);

  // Filtered Sales Invoices
  const filteredInvoices = useMemo(() => {
    return salesInvoices.filter((inv) => {
      if (!showVoided && inv.isVoided) return false;
      if (startDate && inv.transactionDate < startDate) return false;
      if (endDate && inv.transactionDate > endDate) return false;
      if (customerFilter.trim()) {
        const q = customerFilter.toLowerCase();
        const matchesName = (inv.customerNameSnapshot || '').toLowerCase().includes(q);
        const matchesNum = (inv.invoiceNumber || '').toLowerCase().includes(q);
        if (!matchesName && !matchesNum) return false;
      }
      return true;
    });
  }, [salesInvoices, showVoided, startDate, endDate, customerFilter]);

  // Filtered Granular Sales Items
  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (!showVoided && s.isVoided) return false;
      if (startDate && s.transactionDate < startDate) return false;
      if (endDate && s.transactionDate > endDate) return false;
      if (customerFilter.trim()) {
        const q = customerFilter.toLowerCase();
        if (!(s.customerName || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [sales, showVoided, startDate, endDate, customerFilter]);

  // Summary Metrics
  const summary = useMemo(() => {
    return filteredSales
      .filter((s) => !s.isVoided)
      .reduce(
        (acc, s) => {
          acc.count += 1;
          acc.eggs += s.totalEggsEquivalent;
          acc.revenue += s.totalAmountNgn;
          return acc;
        },
        { count: 0, eggs: 0, revenue: 0 }
      );
  }, [filteredSales]);

  const invoicesSummary = useMemo(() => {
    return filteredInvoices
      .filter((i) => !i.isVoided)
      .reduce(
        (acc, i) => {
          acc.count += 1;
          acc.totalBilled += i.totalAmountNgn;
          acc.totalCollected += i.paidAmountNgn;
          acc.totalOutstanding += i.balanceNgn;
          return acc;
        },
        { count: 0, totalBilled: 0, totalCollected: 0, totalOutstanding: 0 }
      );
  }, [filteredInvoices]);

  const openEditModal = (s: EggSale) => {
    setEditingSale(s);
    setEditTxDate(s.transactionDate);
    setEditTxTime(s.transactionTime);
    setEditCustomerName(s.customerName || '');
    const matchedCust = customers.find((c) => (s as any).customerId === c.id || c.name.toLowerCase() === (s.customerName || '').toLowerCase());
    setEditCustomerId(matchedCust ? matchedCust.id : '');
    setEditEggCategory(s.eggCategory);
    setEditQuantity(String(s.quantity));
    setEditUnitPriceNgn(String(s.unitPriceNgn));
    setEditOverrideReason(s.overrideReason);
    setEditPaymentStatus(s.paymentStatus);
    setEditSelectedBatchId(s.batchId || '');
    setEditRemarks(s.remarks);
    setEditFormError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSale) return;
    setEditFormError(null);
    setEditSubmitting(true);
    try {
      const qty = Number(editQuantity);
      const price = Number(editUnitPriceNgn);
      const selectedBatch = editSelectedBatchId ? batchById.get(editSelectedBatchId) || null : null;
      await updateEggSale({
        farmId: farm.farmId,
        sale: editingSale,
        transactionDate: editTxDate,
        transactionTime: editTxTime,
        customerName: editCustomerName,
        eggCategory: editEggCategory,
        quantity: qty,
        unitPriceNgn: price,
        canOverridePrice,
        overrideReason: editOverrideReason,
        paymentStatus: editPaymentStatus,
        batch: selectedBatch,
        remarks: editRemarks,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setFeedback({ type: 'success', text: 'Egg sale updated.' });
      setEditingSale(null);
    } catch (err) {
      setEditFormError(formatUserFriendlyError(err));
    } finally {
      setEditSubmitting(false);
    }
  };

  // If in Create Mode, render the full-page invoice creator
  if (viewMode === 'create') {
    return (
      <SalesInvoiceCreator
        farm={farm}
        member={member}
        customers={customers}
        salesUnits={salesUnits}
        batches={batches}
        eggStoreSettings={eggStoreSettings}
        inventoryBalances={inventoryBalances}
        onCancel={() => setViewMode('list')}
        onInvoiceCreated={(invoice, printImmediately) => {
          setFeedback({
            type: 'success',
            text: `Invoice ${invoice.invoiceNumber} (${formatNgn(invoice.totalAmountNgn)}) recorded successfully.`,
          });
          if (printImmediately) {
            setActivePrintInvoice(invoice);
            setViewMode('print');
          } else {
            setViewMode('list');
          }
        }}
      />
    );
  }

  // If in Print Mode, render the invoice printable document
  if (viewMode === 'print' && activePrintInvoice) {
    return (
      <InvoicePrintDocument
        farm={farm}
        docType="sales"
        salesInvoice={activePrintInvoice}
        onClose={() => {
          setActivePrintInvoice(null);
          setViewMode('list');
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Egg Sales &amp; Invoices</h1>
          <p className="mt-1 text-xs text-slate-500">
            Create professional multi-product sales invoices, print receipts, and manage customer credit and accounts receivable.
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={() => setViewMode('create')}
            disabled={activeUnits.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 shadow-xs disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Create Sales Invoice</span>
          </button>
        )}
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {activeUnits.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No egg selling units configured yet. Configure Crate of 30 / Half Crate / Single Egg prices
          in Farm Setup first.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
        {trueInventoryMode
          ? 'True Egg Sales deducts Egg Store stock lots atomically and rejects sales above available store inventory.'
          : 'Phantom Egg Sales records revenue without deducting Egg Store physical stock.'}
      </div>

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 tabular-nums">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Total Invoices</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900">{invoicesSummary.count}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{summary.count} line items</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Total Eggs Sold</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900">
            {formatEggQuantity(summary.eggs)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Total Sales Value</p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-800">
            {formatNgn(summary.revenue)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Outstanding Receivable</p>
          <p
            className={`mt-1 font-mono text-xl font-bold ${
              invoicesSummary.totalOutstanding > 0 ? 'text-amber-700' : 'text-slate-700'
            }`}
          >
            {formatNgn(invoicesSummary.totalOutstanding)}
          </p>
        </div>
      </div>

      {/* Filters & Sub-tabs */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Sub-tab Switcher */}
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setSalesTab('invoices')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                salesTab === 'invoices'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Sales Invoices ({filteredInvoices.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSalesTab('items')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                salesTab === 'items'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Egg Sales Ledger ({filteredSales.length})</span>
            </button>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showVoided}
              onChange={(e) => setShowVoided(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-800"
            />
            <span>Include voided records</span>
          </label>
        </div>

        {/* Filter Bar */}
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
          <div>
            <label htmlFor="sales-start" className="block text-xs font-medium text-slate-600">
              From Date
            </label>
            <input
              id="sales-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
            />
          </div>
          <div>
            <label htmlFor="sales-end" className="block text-xs font-medium text-slate-600">
              To Date
            </label>
            <input
              id="sales-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
            />
          </div>
          <div>
            <label htmlFor="cust-search" className="block text-xs font-medium text-slate-600">
              Search Customer / Invoice #
            </label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                id="cust-search"
                type="text"
                placeholder="Search name or INV-..."
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {salesTab === 'invoices' ? (
        /* Invoices Table */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          {filteredInvoices.length === 0 ? (
            <div className="p-8 text-center">
              <FileText className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-800">No sales invoices found.</p>
              <p className="mt-1 text-xs text-slate-500">
                Click "Create Sales Invoice" above to generate a multi-item printable invoice.
              </p>
            </div>
          ) : (
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase text-[11px]">
                    <th className="px-4 py-3">Invoice # / Date</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Items Summary</th>
                    <th className="px-4 py-3 text-right">Total Amount</th>
                    <th className="px-4 py-3 text-right">Amount Paid</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredInvoices.map((inv) => {
                    const isWalkIn = inv.customerId === 'walk-in';
                    const itemsSummary = inv.lines
                      .map((l) => `${l.quantity} × ${l.unitNameSnapshot}`)
                      .join(', ');

                    return (
                      <tr
                        key={inv.id}
                        className={inv.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50/60'}
                      >
                        <td className="px-4 py-3 font-mono">
                          <div className={inv.isVoided ? 'line-through' : 'font-bold text-slate-900'}>
                            {inv.invoiceNumber}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {formatIsoDateDisplay(inv.transactionDate)} {inv.transactionTime || ''}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span>{inv.customerNameSnapshot}</span>
                            {isWalkIn && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                Walk-in
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-xs truncate text-slate-600" title={itemsSummary}>
                          {itemsSummary}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                          {formatNgn(inv.totalAmountNgn)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-800 font-semibold">
                          {formatNgn(inv.paidAmountNgn)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-bold ${
                            inv.balanceNgn > 0 ? 'text-red-700' : 'text-slate-500'
                          }`}
                        >
                          {formatNgn(inv.balanceNgn)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                              inv.paymentStatus === 'paid'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inv.paymentStatus === 'partial'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {inv.paymentStatus}
                          </span>
                          {inv.isVoided && (
                            <div className="text-[10px] font-bold text-red-600 mt-0.5">VOIDED</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setActivePrintInvoice(inv);
                                setViewMode('print');
                              }}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 text-[11px] font-semibold cursor-pointer"
                              title="Print Invoice / Receipt"
                            >
                              <Printer className="h-3 w-3" />
                              <span>Print</span>
                            </button>
                            {!inv.isVoided && canDelete && (
                              <button
                                type="button"
                                onClick={() => setVoidInvoiceTarget(inv)}
                                className="rounded border border-red-200 p-1 text-red-700 hover:bg-red-50 cursor-pointer"
                                title="Void invoice"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Granular Line Items Table */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          {filteredSales.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-800">No egg sale items in this filter.</p>
              <p className="mt-1 text-xs text-slate-500">Record a sale using the button above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase text-[11px]">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Customer / Category</th>
                    <th className="px-4 py-3">Flock / Batch</th>
                    <th className="px-4 py-3">Selling Unit</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Unit Price</th>
                    <th className="px-4 py-3 text-right">Total Amount</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredSales.map((s) => (
                    <tr key={s.id} className={s.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-3 font-mono">
                        <div className={s.isVoided ? 'line-through' : 'font-medium text-slate-900'}>
                          {formatIsoDateDisplay(s.transactionDate)}
                        </div>
                        <div className="text-[11px] text-slate-500">{s.transactionTime || '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{s.customerName || 'Walk-in Customer'}</div>
                        <div className="text-slate-500">{s.eggCategory}</div>
                      </td>
                      <td className="px-4 py-3">
                        {s.batchCodeSnapshot ? (
                          <span className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-900">
                            {s.batchCodeSnapshot}
                          </span>
                        ) : (
                          <span className="text-slate-500">Pooled (Farm Room)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>{s.unitNameSnapshot}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatEggQuantity(s.totalEggsEquivalent)} total
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{s.quantity}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        <div>{formatNgn(s.unitPriceNgn)}</div>
                        {s.priceOverridden && (
                          <div className="text-[11px] text-amber-700">
                            Override (std {formatNgn(s.suggestedUnitPriceNgn)})
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-800">
                        {formatNgn(s.totalAmountNgn)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-medium capitalize ${
                            s.paymentStatus === 'paid'
                              ? 'text-emerald-800'
                              : s.paymentStatus === 'partial'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {s.paymentStatus}
                        </span>
                        {s.isVoided && (
                          <div className="text-[11px] font-medium text-red-700">
                            VOIDED: {s.voidReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!s.isVoided && (
                          <div className="inline-flex items-center gap-2">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditModal(s)}
                                className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100 cursor-pointer"
                                title="Edit sale"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => setVoidTarget(s)}
                                className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 cursor-pointer"
                                title="Void sale"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit Single Sale Modal */}
      {editingSale && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] sm:max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Edit Egg Sale</h2>
              <button
                type="button"
                onClick={() => setEditingSale(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
              {editFormError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {editFormError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="edit-sale-date" className="block text-xs font-medium text-slate-700">
                    Sale Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="edit-sale-date"
                    type="date"
                    required
                    value={editTxDate}
                    onChange={(e) => setEditTxDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-time" className="block text-xs font-medium text-slate-700">
                    Time (Optional)
                  </label>
                  <input
                    id="edit-sale-time"
                    type="time"
                    value={editTxTime}
                    onChange={(e) => setEditTxTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="edit-sale-customer" className="block text-xs font-medium text-slate-700">
                    Customer
                  </label>
                  <select
                    id="edit-sale-customer"
                    value={editCustomerId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      setEditCustomerId(cid);
                      if (cid) {
                        const foundC = customers.find((c) => c.id === cid);
                        if (foundC) setEditCustomerName(foundC.name);
                      } else {
                        setEditCustomerName('');
                      }
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Walk-in Customer (Unregistered)</option>
                    {activeCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </option>
                    ))}
                  </select>
                  {!editCustomerId && (
                    <input
                      type="text"
                      maxLength={120}
                      value={editCustomerName}
                      onChange={(e) => setEditCustomerName(e.target.value)}
                      placeholder="Customer Name (optional for walk-in)"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="edit-sale-category" className="block text-xs font-medium text-slate-700">
                    Egg Category / Grade
                  </label>
                  <input
                    id="edit-sale-category"
                    type="text"
                    required
                    maxLength={80}
                    value={editEggCategory}
                    onChange={(e) => setEditEggCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Selling unit: <strong>{editingSale.unitNameSnapshot}</strong> ({editingSale.eggsPerUnitSnapshot} eggs/unit)
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="edit-sale-qty" className="block text-xs font-medium text-slate-700">
                    Quantity <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="edit-sale-qty"
                    type="number"
                    step="0.5"
                    min="0.5"
                    required
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-price" className="block text-xs font-medium text-slate-700">
                    Unit Price (NGN)
                  </label>
                  <input
                    id="edit-sale-price"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    disabled={!canOverridePrice}
                    value={editUnitPriceNgn}
                    onChange={(e) => setEditUnitPriceNgn(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-payment" className="block text-xs font-medium text-slate-700">
                    Payment Status
                  </label>
                  <select
                    id="edit-sale-payment"
                    value={editPaymentStatus}
                    onChange={(e) => setEditPaymentStatus(e.target.value as PaymentStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="paid">Paid</option>
                    <option value="partial">Partial</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>

              {canOverridePrice && (
                <div>
                  <label htmlFor="edit-sale-override" className="block text-xs font-medium text-amber-800">
                    Price Override Reason
                  </label>
                  <input
                    id="edit-sale-override"
                    type="text"
                    maxLength={300}
                    value={editOverrideReason}
                    onChange={(e) => setEditOverrideReason(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-2 text-sm"
                  />
                </div>
              )}

              <div>
                <label htmlFor="edit-sale-batch" className="block text-xs font-medium text-slate-700">
                  Flock / Batch Attribution (Optional)
                </label>
                <select
                  id="edit-sale-batch"
                  value={editSelectedBatchId}
                  onChange={(e) => setEditSelectedBatchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Pooled / Farm Egg Room</option>
                  {activeBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchCode} ({b.penNameSnapshot})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="edit-sale-remarks" className="block text-xs font-medium text-slate-700">
                  Remarks
                </label>
                <textarea
                  id="edit-sale-remarks"
                  rows={2}
                  maxLength={500}
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingSale(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60 cursor-pointer"
                >
                  {editSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Void Single Sale Modal */}
      <ConfirmVoidModal
        open={Boolean(voidTarget)}
        title="Void Egg Sale?"
        description={`Voiding this sale (${formatNgn(voidTarget?.totalAmountNgn || 0)} on ${voidTarget?.transactionDate || ''}) will exclude it from revenue totals and automatically reverse Egg Store inventory deductions if recorded under True Egg Sales.`}
        confirmLabel="Void Sale"
        onConfirm={async (reason) => {
          if (!voidTarget) return;
          await voidEggSale({
            farmId: farm.farmId,
            sale: voidTarget,
            voidReason: reason,
            actorUid: member.uid,
            actorName: member.displayName,
          });
          setFeedback({ type: 'success', text: 'Egg sale voided and stock restored.' });
        }}
        onClose={() => setVoidTarget(null)}
      />

      {/* Confirm Void Invoice Modal */}
      <ConfirmVoidModal
        open={Boolean(voidInvoiceTarget)}
        title={`Void Invoice ${voidInvoiceTarget?.invoiceNumber || ''}?`}
        description={`Voiding this invoice (${formatNgn(voidInvoiceTarget?.totalAmountNgn || 0)}) will mark the invoice voided, void all ${voidInvoiceTarget?.lines.length || 0} associated egg sales items, and reverse customer receivables.`}
        confirmLabel="Void Invoice"
        onConfirm={async (reason) => {
          if (!voidInvoiceTarget) return;
          await voidSalesInvoice({
            farmId: farm.farmId,
            invoice: voidInvoiceTarget,
            voidReason: reason,
            actor: member,
          });
          setFeedback({ type: 'success', text: `Invoice ${voidInvoiceTarget.invoiceNumber} voided.` });
        }}
        onClose={() => setVoidInvoiceTarget(null)}
      />
    </div>
  );
};
