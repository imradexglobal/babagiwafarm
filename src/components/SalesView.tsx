import React, { useMemo, useState } from 'react';
import { Ban, Edit2, Plus, X } from 'lucide-react';
import {
  formatDateInTimezone,
  formatNgn,
  hasPermission,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { createEggSale, updateEggSale, voidEggSale } from '../services/salesService.ts';
import type { EggSale, Farm, FarmMember, PaymentStatus, SalesUnit } from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';

interface SalesViewProps {
  farm: Farm;
  member: FarmMember;
  salesUnits: SalesUnit[];
  sales: EggSale[];
}

export const SalesView: React.FC<SalesViewProps> = ({ farm, member, salesUnits, sales }) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canCreate = hasPermission(member, 'sales', 'create');
  const canEdit = hasPermission(member, 'sales', 'edit');
  const canDelete = hasPermission(member, 'sales', 'delete');
  const canOverridePrice = hasPermission(member, 'sales', 'overridePrice');

  const activeUnits = useMemo(() => salesUnits.filter((u) => u.status === 'active'), [salesUnits]);
  const unitById = useMemo(() => new Map(salesUnits.map((u) => [u.id, u])), [salesUnits]);

  // Filters
  const [startDate, setStartDate] = useState(`${todayStr.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(todayStr);
  const [showVoided, setShowVoided] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<EggSale | null>(null);
  const [voidTarget, setVoidTarget] = useState<EggSale | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form fields
  const [txDate, setTxDate] = useState(todayStr);
  const [txTime, setTxTime] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [eggCategory, setEggCategory] = useState('Standard Brown');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPriceNgn, setUnitPriceNgn] = useState('0');
  const [overrideReason, setOverrideReason] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('paid');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (!showVoided && s.isVoided) return false;
      if (startDate && s.transactionDate < startDate) return false;
      if (endDate && s.transactionDate > endDate) return false;
      return true;
    });
  }, [sales, showVoided, startDate, endDate]);

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

  const openCreateModal = () => {
    const first = activeUnits[0];
    setEditingSale(null);
    setTxDate(todayStr);
    setTxTime('');
    setCustomerName('');
    setEggCategory('Standard Brown');
    setSelectedUnitId(first?.id || '');
    setQuantity('1');
    setUnitPriceNgn(String(first?.currentPriceNgn ?? 0));
    setOverrideReason('');
    setPaymentStatus('paid');
    setRemarks('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (s: EggSale) => {
    setEditingSale(s);
    setTxDate(s.transactionDate);
    setTxTime(s.transactionTime);
    setCustomerName(s.customerName);
    setEggCategory(s.eggCategory);
    setSelectedUnitId(s.salesUnitId);
    setQuantity(String(s.quantity));
    setUnitPriceNgn(String(s.unitPriceNgn));
    setOverrideReason(s.overrideReason);
    setPaymentStatus(s.paymentStatus);
    setRemarks(s.remarks);
    setFormError(null);
    setModalOpen(true);
  };

  const selectedUnit = unitById.get(selectedUnitId);
  const suggestedPrice = editingSale
    ? editingSale.suggestedUnitPriceNgn
    : selectedUnit?.currentPriceNgn ?? 0;
  const numericPrice = Number(unitPriceNgn || 0);
  const isOverriding = Math.abs(numericPrice - suggestedPrice) > 0.001;
  const previewTotal = (Number(quantity) || 0) * numericPrice;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const qty = Number(quantity);
      const price = Number(unitPriceNgn);
      if (editingSale) {
        await updateEggSale({
          farmId: farm.farmId,
          sale: editingSale,
          transactionDate: txDate,
          transactionTime: txTime,
          customerName,
          eggCategory,
          quantity: qty,
          unitPriceNgn: price,
          canOverridePrice,
          overrideReason,
          paymentStatus,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: 'Egg sale updated.' });
      } else {
        const unit = unitById.get(selectedUnitId);
        if (!unit) throw new Error('Please select a selling unit.');
        await createEggSale({
          farmId: farm.farmId,
          transactionDate: txDate,
          transactionTime: txTime,
          customerName,
          eggCategory,
          salesUnit: unit,
          quantity: qty,
          unitPriceNgn: price,
          canOverridePrice,
          overrideReason,
          paymentStatus,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({
          type: 'success',
          text: `Recorded sale of ${qty} × ${unit.name} (${formatNgn(qty * price)}).`,
        });
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(formatUserFriendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Egg Sales</h1>
          <p className="mt-1 text-xs text-slate-500">
            Unit definitions and prices are snapshotted at sale time; future price changes never alter past sales.
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            disabled={activeUnits.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Record Egg Sale</span>
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
        Note on Egg Inventory Scope: This MVP records egg production and egg sales as independent
        transaction ledgers and does not enforce graded egg-room stock deduction across categories.
      </div>

      {/* Filters & Totals */}
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
        <div className="flex items-end pb-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showVoided}
              onChange={(e) => setShowVoided(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-800"
            />
            <span>Include voided sales</span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 tabular-nums">
        <div>
          <p className="text-xs text-slate-500">Sales Transactions</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">{summary.count}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Total Eggs Sold (Equivalent)</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
            {summary.eggs.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Total Sales Revenue</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-emerald-800">
            {formatNgn(summary.revenue)}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {filteredSales.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-800">No egg sales in this date filter.</p>
            <p className="mt-1 text-xs text-slate-500">Record a sale using the button above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Customer / Category</th>
                  <th className="px-4 py-3 font-medium">Selling Unit</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 text-right font-medium">Unit Price</th>
                  <th className="px-4 py-3 text-right font-medium">Total Amount</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {filteredSales.map((s) => (
                  <tr key={s.id} className={s.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-mono">
                      <div className={s.isVoided ? 'line-through' : 'font-medium text-slate-900'}>
                        {s.transactionDate}
                      </div>
                      <div className="text-[11px] text-slate-500">{s.transactionTime || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{s.customerName || 'Walk-in Customer'}</div>
                      <div className="text-slate-500">{s.eggCategory}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{s.unitNameSnapshot}</div>
                      <div className="text-[11px] text-slate-500">
                        {s.totalEggsEquivalent.toLocaleString()} eggs total
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
                              className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                              title="Edit sale"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setVoidTarget(s)}
                              className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
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

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">
                {editingSale ? 'Edit Egg Sale' : 'Record Egg Sale'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {formError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="sale-date" className="block text-xs font-medium text-slate-700">
                    Sale Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="sale-date"
                    type="date"
                    required
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="sale-time" className="block text-xs font-medium text-slate-700">
                    Time (Optional)
                  </label>
                  <input
                    id="sale-time"
                    type="time"
                    value={txTime}
                    onChange={(e) => setTxTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="sale-customer" className="block text-xs font-medium text-slate-700">
                    Customer Name (Optional)
                  </label>
                  <input
                    id="sale-customer"
                    type="text"
                    maxLength={120}
                    placeholder="e.g. Walk-in / Alhaji Musa"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="sale-category" className="block text-xs font-medium text-slate-700">
                    Egg Category / Grade
                  </label>
                  <input
                    id="sale-category"
                    type="text"
                    required
                    maxLength={80}
                    value={eggCategory}
                    onChange={(e) => setEggCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {!editingSale ? (
                <div>
                  <label htmlFor="sale-unit" className="block text-xs font-medium text-slate-700">
                    Selling Unit <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="sale-unit"
                    required
                    value={selectedUnitId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedUnitId(nextId);
                      const found = unitById.get(nextId);
                      if (found) setUnitPriceNgn(String(found.currentPriceNgn));
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select unit...</option>
                    {activeUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.eggCountPerUnit} eggs) — {formatNgn(u.currentPriceNgn)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Selling unit snapshot: <strong>{editingSale.unitNameSnapshot}</strong> (
                  {editingSale.eggsPerUnitSnapshot} eggs/unit)
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="sale-qty" className="block text-xs font-medium text-slate-700">
                    Quantity <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="sale-qty"
                    type="number"
                    step="0.5"
                    min="0.5"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="sale-price" className="block text-xs font-medium text-slate-700">
                    Unit Price (NGN)
                  </label>
                  <input
                    id="sale-price"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    disabled={!canOverridePrice}
                    value={unitPriceNgn}
                    onChange={(e) => setUnitPriceNgn(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100"
                  />
                  {!canOverridePrice && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Price locked to configured rate.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="sale-payment" className="block text-xs font-medium text-slate-700">
                    Payment Status
                  </label>
                  <select
                    id="sale-payment"
                    value={paymentStatus}
                    onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="paid">Paid</option>
                    <option value="partial">Partial</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>

              {isOverriding && canOverridePrice && (
                <div>
                  <label htmlFor="sale-override-reason" className="block text-xs font-medium text-amber-800">
                    Price Override Reason (Suggested {formatNgn(suggestedPrice)}) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="sale-override-reason"
                    type="text"
                    required
                    maxLength={300}
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Reason for diverging from configured unit price"
                    className="mt-1 w-full rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-2 text-sm"
                  />
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs tabular-nums">
                <span>Total Amount</span>
                <strong className="font-mono text-base text-emerald-800">
                  {formatNgn(previewTotal)}
                </strong>
              </div>

              <div>
                <label htmlFor="sale-remarks" className="block text-xs font-medium text-slate-700">
                  Remarks
                </label>
                <textarea
                  id="sale-remarks"
                  rows={2}
                  maxLength={500}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
                >
                  {submitting ? 'Saving...' : editingSale ? 'Save Changes' : 'Save Sale'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmVoidModal
        open={Boolean(voidTarget)}
        title="Void Egg Sale?"
        description={`Voiding this sale (${formatNgn(voidTarget?.totalAmountNgn || 0)} on ${voidTarget?.transactionDate || ''}) will exclude it from revenue totals while preserving audit records.`}
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
          setFeedback({ type: 'success', text: 'Egg sale voided.' });
        }}
        onClose={() => setVoidTarget(null)}
      />
    </div>
  );
};
