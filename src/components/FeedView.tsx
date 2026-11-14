import React, { useMemo, useState } from 'react';
import { Ban, Edit2, Plus, ShoppingCart, Wheat, X } from 'lucide-react';
import {
  DEFAULT_BAG_WEIGHT_KG,
  computeConsumptionCostNgn,
  convertFeedToGrams,
  findQualifyingPurchaseForConsumption,
  formatDateInTimezone,
  formatGramsToKgAndBags,
  formatNgn,
  hasPermission,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import {
  createFeedConsumption,
  createFeedPurchase,
  updateFeedConsumptionMeta,
  voidFeedConsumption,
  voidFeedPurchase,
} from '../services/feedService.ts';
import type {
  Farm,
  FarmMember,
  FeedConsumption,
  FeedItem,
  FeedPurchase,
  FeedStock,
  FeedUnit,
  PoultryBatch,
} from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';

interface FeedViewProps {
  farm: Farm;
  member: FarmMember;
  batches: PoultryBatch[];
  feedItems: FeedItem[];
  feedStocks: FeedStock[];
  purchases: FeedPurchase[];
  consumptions: FeedConsumption[];
}

export const FeedView: React.FC<FeedViewProps> = ({
  farm,
  member,
  batches,
  feedItems,
  feedStocks,
  purchases,
  consumptions,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canCreate = hasPermission(member, 'feed', 'create');
  const canEdit = hasPermission(member, 'feed', 'edit');
  const canDelete = hasPermission(member, 'feed', 'delete');

  const activeItems = useMemo(() => feedItems.filter((i) => i.status === 'active'), [feedItems]);
  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const itemById = useMemo(() => new Map(feedItems.map((i) => [i.id, i])), [feedItems]);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const stockByItemId = useMemo(() => new Map(feedStocks.map((s) => [s.feedItemId, s])), [feedStocks]);

  const [tab, setTab] = useState<'consumption' | 'purchases'>('consumption');
  const [showVoided, setShowVoided] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [consumptionModalOpen, setConsumptionModalOpen] = useState(false);
  const [editingConsumption, setEditingConsumption] = useState<FeedConsumption | null>(null);
  const [voidPurchaseTarget, setVoidPurchaseTarget] = useState<FeedPurchase | null>(null);
  const [voidConsTarget, setVoidConsTarget] = useState<FeedConsumption | null>(null);

  // Purchase form
  const [purDate, setPurDate] = useState(todayStr);
  const [purFeedId, setPurFeedId] = useState('');
  const [purQty, setPurQty] = useState('');
  const [purUnit, setPurUnit] = useState<FeedUnit>('bags');
  const [purBagWeight, setPurBagWeight] = useState('25');
  const [purUnitPrice, setPurUnitPrice] = useState('');
  const [purSupplier, setPurSupplier] = useState('');
  const [purRef, setPurRef] = useState('');
  const [purRemarks, setPurRemarks] = useState('');
  const [purError, setPurError] = useState<string | null>(null);
  const [purSubmitting, setPurSubmitting] = useState(false);

  // Consumption form
  const [consDate, setConsDate] = useState(todayStr);
  const [consTime, setConsTime] = useState('');
  const [consBatchId, setConsBatchId] = useState('');
  const [consFeedId, setConsFeedId] = useState('');
  const [consQty, setConsQty] = useState('');
  const [consUnit, setConsUnit] = useState<FeedUnit>('bags');
  const [consRemarks, setConsRemarks] = useState('');
  const [consError, setConsError] = useState<string | null>(null);
  const [consSubmitting, setConsSubmitting] = useState(false);

  const openPurchaseModal = () => {
    const first = activeItems[0];
    setPurDate(todayStr);
    setPurFeedId(first?.id || '');
    setPurQty('');
    setPurUnit('bags');
    setPurBagWeight(String(first?.defaultBagWeightKg ?? DEFAULT_BAG_WEIGHT_KG));
    setPurUnitPrice('');
    setPurSupplier('');
    setPurRef('');
    setPurRemarks('');
    setPurError(null);
    setPurchaseModalOpen(true);
  };

  const openConsumptionModal = () => {
    setEditingConsumption(null);
    setConsDate(todayStr);
    setConsTime('');
    setConsBatchId(activeBatches[0]?.id || '');
    setConsFeedId(activeItems[0]?.id || '');
    setConsQty('');
    setConsUnit('bags');
    setConsRemarks('');
    setConsError(null);
    setConsumptionModalOpen(true);
  };

  const openEditConsumptionModal = (c: FeedConsumption) => {
    setEditingConsumption(c);
    setConsDate(c.transactionDate);
    setConsTime(c.transactionTime);
    setConsBatchId(c.batchId);
    setConsFeedId(c.feedItemId);
    setConsQty(String(c.enteredQuantity));
    setConsUnit(c.enteredUnit);
    setConsRemarks(c.remarks);
    setConsError(null);
    setConsumptionModalOpen(true);
  };

  // Live purchase preview
  const purPreview = useMemo(() => {
    const qty = Number(purQty);
    const bagW = Number(purBagWeight);
    const unitPrice = Number(purUnitPrice);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(bagW) || bagW <= 0) return null;
    try {
      const grams = convertFeedToGrams(qty, purUnit, bagW);
      const totalNgn = Number.isFinite(unitPrice) && unitPrice >= 0 ? qty * unitPrice : 0;
      const costPerKg = grams > 0 ? (totalNgn / grams) * 1000 : 0;
      return { grams, kg: grams / 1000, totalNgn, costPerKg };
    } catch {
      return null;
    }
  }, [purQty, purUnit, purBagWeight, purUnitPrice]);

  // Live consumption cost & stock preview
  const consPreview = useMemo(() => {
    if (editingConsumption) return null;
    const item = itemById.get(consFeedId);
    const qty = Number(consQty);
    if (!item || !consDate) return null;
    const stock = stockByItemId.get(item.id);
    const availableGrams = stock?.balanceGrams ?? 0;
    const availFormatted = formatGramsToKgAndBags(availableGrams, item.defaultBagWeightKg);

    const qualifying = findQualifyingPurchaseForConsumption(purchases, item.id, consDate);
    if (!Number.isFinite(qty) || qty <= 0) {
      return {
        availableGrams,
        availFormatted,
        qualifying,
        requestedGrams: 0,
        insufficient: false,
        estimatedCostNgn: 0,
      };
    }

    const requestedGrams = convertFeedToGrams(qty, consUnit, item.defaultBagWeightKg);
    const insufficient = requestedGrams > availableGrams;
    const estimatedCostNgn = qualifying
      ? computeConsumptionCostNgn(requestedGrams, qualifying.unitCostPerGramNgn)
      : 0;

    return {
      availableGrams,
      availFormatted,
      qualifying,
      requestedGrams,
      insufficient,
      estimatedCostNgn,
    };
  }, [editingConsumption, itemById, consFeedId, consQty, consUnit, consDate, stockByItemId, purchases]);

  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPurError(null);
    setPurSubmitting(true);
    try {
      const item = itemById.get(purFeedId);
      if (!item) throw new Error('Please select a feed type & brand.');
      await createFeedPurchase({
        farmId: farm.farmId,
        transactionDate: purDate,
        feedItem: item,
        enteredQuantity: Number(purQty),
        enteredUnit: purUnit,
        bagWeightKg: Number(purBagWeight),
        unitPurchasePriceNgn: Number(purUnitPrice),
        supplier: purSupplier,
        reference: purRef,
        remarks: purRemarks,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setFeedback({ type: 'success', text: `Feed purchase recorded for ${item.feedType} (${item.brand}).` });
      setPurchaseModalOpen(false);
    } catch (err) {
      setPurError(formatUserFriendlyError(err));
    } finally {
      setPurSubmitting(false);
    }
  };

  const handleConsumptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConsError(null);
    setConsSubmitting(true);
    try {
      if (editingConsumption) {
        await updateFeedConsumptionMeta({
          farmId: farm.farmId,
          consumption: editingConsumption,
          transactionDate: consDate,
          transactionTime: consTime,
          remarks: consRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: 'Feed consumption notes/date updated (cost snapshot unchanged).' });
      } else {
        const batch = batchById.get(consBatchId);
        const item = itemById.get(consFeedId);
        if (!batch) throw new Error('Please select an active batch.');
        if (!item) throw new Error('Please select a feed item.');
        await createFeedConsumption({
          farmId: farm.farmId,
          transactionDate: consDate,
          transactionTime: consTime,
          batch,
          feedItem: item,
          enteredQuantity: Number(consQty),
          enteredUnit: consUnit,
          remarks: consRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({
          type: 'success',
          text: `Recorded feed consumption for ${batch.batchCode} with locked historical cost.`,
        });
      }
      setConsumptionModalOpen(false);
    } catch (err) {
      setConsError(formatUserFriendlyError(err));
    } finally {
      setConsSubmitting(false);
    }
  };

  const visiblePurchases = useMemo(
    () => purchases.filter((p) => showVoided || !p.isVoided),
    [purchases, showVoided]
  );
  const visibleConsumptions = useMemo(
    () => consumptions.filter((c) => showVoided || !c.isVoided),
    [consumptions, showVoided]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Feed Inventory, Purchases &amp; Consumption
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Authoritative stock stored in grams; consumption locks cost from the latest qualifying purchase on or before consumption date.
          </p>
        </div>

        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openPurchaseModal}
              disabled={activeItems.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <ShoppingCart className="h-4 w-4 text-emerald-800" />
              <span>Record Purchase (In)</span>
            </button>
            <button
              type="button"
              onClick={openConsumptionModal}
              disabled={activeItems.length === 0 || activeBatches.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Record Consumption (Out)</span>
            </button>
          </div>
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

      {activeItems.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No feed types/brands configured yet. Add feed items (with bag weight default) in Farm Setup first.
        </div>
      )}

      {/* Stock Overview Cards */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Wheat className="h-4 w-4 text-emerald-800" />
            <h2 className="text-sm font-semibold text-slate-900">Current Feed Stock by Type &amp; Brand</h2>
          </div>
          <span className="text-xs text-slate-500">Live transactional balance (negative stock blocked)</span>
        </div>

        {feedItems.length === 0 ? (
          <p className="py-4 text-xs text-slate-500">No feed items configured.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {feedItems.map((item) => {
              const stock = stockByItemId.get(item.id);
              const balGrams = stock?.balanceGrams ?? 0;
              const formatted = formatGramsToKgAndBags(balGrams, item.defaultBagWeightKg);
              const latestKgCost = stock ? stock.lastUnitCostPerGramNgn * 1000 : 0;

              return (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.feedType}</p>
                      <p className="text-xs text-slate-500">
                        {item.brand} · {item.defaultBagWeightKg} kg/bag
                      </p>
                    </div>
                    <span className="text-[11px] font-medium text-slate-500 capitalize">
                      {item.status}
                    </span>
                  </div>
                  <p
                    className={`mt-3 font-mono text-lg font-bold tabular-nums ${
                      balGrams <= 0 ? 'text-amber-700' : 'text-emerald-800'
                    }`}
                  >
                    {formatted.kgText}
                  </p>
                  <p className="text-xs font-mono text-slate-600 tabular-nums">
                    {formatted.bagsText}
                    {latestKgCost > 0 && ` · Last purchase ${formatNgn(latestKgCost)}/kg`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setTab('consumption')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === 'consumption'
                ? 'bg-emerald-800 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Consumption (Stock-Out)
          </button>
          <button
            type="button"
            onClick={() => setTab('purchases')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === 'purchases'
                ? 'bg-emerald-800 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Purchases (Stock-In)
          </button>
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-800"
          />
          <span>Include voided transactions</span>
        </label>
      </div>

      {/* Ledger Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {tab === 'consumption' ? (
          visibleConsumptions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-800">No feed consumption records yet.</p>
              <p className="mt-1 text-xs text-slate-500">
                Record a feed purchase first, then issue feed to an active batch.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Batch / Pen</th>
                    <th className="px-4 py-3 font-medium">Feed / Brand</th>
                    <th className="px-4 py-3 text-right font-medium">Entered</th>
                    <th className="px-4 py-3 text-right font-medium">Std. (kg)</th>
                    <th className="px-4 py-3 text-right font-medium">Cost Snapshot</th>
                    <th className="px-4 py-3 font-medium">Cost Source Date</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {visibleConsumptions.map((c) => (
                    <tr key={c.id} className={c.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-3 font-mono">
                        <div className={c.isVoided ? 'line-through' : 'font-medium text-slate-900'}>
                          {c.transactionDate}
                        </div>
                        <div className="text-[11px] text-slate-500">{c.transactionTime || '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{c.batchCodeSnapshot}</div>
                        <div className="text-slate-500">{c.penNameSnapshot}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{c.feedTypeSnapshot}</div>
                        <div className="text-slate-500">{c.brandSnapshot}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {c.enteredQuantity} {c.enteredUnit}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-900">
                        {(c.standardizedGrams / 1000).toFixed(2)} kg
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                        {formatNgn(c.totalCostNgn)}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">
                        <div>{c.costSourcePurchaseDate || '—'}</div>
                        {c.isVoided && (
                          <div className="font-sans text-[11px] font-medium text-red-700">
                            VOIDED: {c.voidReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!c.isVoided && (
                          <div className="inline-flex items-center gap-2">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditConsumptionModal(c)}
                                className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                title="Edit date/remarks"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => setVoidConsTarget(c)}
                                className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                                title="Void and restore stock"
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
          )
        ) : visiblePurchases.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-800">No feed purchases recorded yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Record a feed purchase to add stock and establish cost per gram.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 font-medium">Purchase Date</th>
                  <th className="px-4 py-3 font-medium">Feed / Brand</th>
                  <th className="px-4 py-3 text-right font-medium">Entered</th>
                  <th className="px-4 py-3 text-right font-medium">Std. (kg)</th>
                  <th className="px-4 py-3 text-right font-medium">Unit Price</th>
                  <th className="px-4 py-3 text-right font-medium">Total Cost</th>
                  <th className="px-4 py-3 font-medium">Supplier / Ref</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {visiblePurchases.map((p) => (
                  <tr key={p.id} className={p.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-mono font-medium text-slate-900">
                      <span className={p.isVoided ? 'line-through' : ''}>{p.transactionDate}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{p.feedTypeSnapshot}</div>
                      <div className="text-slate-500">{p.brandSnapshot}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {p.enteredQuantity} {p.enteredUnit}
                      <div className="text-[11px] text-slate-500">({p.bagWeightKgSnapshot} kg/bag)</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-900">
                      {(p.standardizedGrams / 1000).toFixed(2)} kg
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatNgn(p.unitPurchasePriceNgn)}/{p.enteredUnit === 'bags' ? 'bag' : 'kg'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                      {formatNgn(p.totalCostNgn)}
                    </td>
                    <td className="px-4 py-3">
                      <div>{p.supplier || '—'}</div>
                      <div className="text-[11px] text-slate-500">{p.reference || '—'}</div>
                      {p.isVoided && (
                        <div className="text-[11px] font-medium text-red-700">
                          VOIDED: {p.voidReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!p.isVoided && canDelete && (
                        <button
                          type="button"
                          onClick={() => setVoidPurchaseTarget(p)}
                          className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                          title="Void purchase"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Purchase Modal */}
      {purchaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Record Feed Purchase (Stock-In)</h2>
              <button
                type="button"
                onClick={() => setPurchaseModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handlePurchaseSubmit} className="mt-4 space-y-4">
              {purError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {purError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="pur-date" className="block text-xs font-medium text-slate-700">
                    Purchase Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="pur-date"
                    type="date"
                    required
                    value={purDate}
                    onChange={(e) => setPurDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="pur-feed" className="block text-xs font-medium text-slate-700">
                    Feed Type &amp; Brand <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="pur-feed"
                    required
                    value={purFeedId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setPurFeedId(nextId);
                      const found = itemById.get(nextId);
                      if (found) setPurBagWeight(String(found.defaultBagWeightKg));
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select feed...</option>
                    {activeItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.feedType} — {i.brand}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="pur-qty" className="block text-xs font-medium text-slate-700">
                    Quantity <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="pur-qty"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={purQty}
                    onChange={(e) => setPurQty(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="pur-unit" className="block text-xs font-medium text-slate-700">
                    Unit
                  </label>
                  <select
                    id="pur-unit"
                    value={purUnit}
                    onChange={(e) => setPurUnit(e.target.value as FeedUnit)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="bags">Bags</option>
                    <option value="kg">Kilograms (kg)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="pur-bag-wt" className="block text-xs font-medium text-slate-700">
                    Bag Weight (kg)
                  </label>
                  <input
                    id="pur-bag-wt"
                    type="number"
                    step="0.1"
                    min="0.1"
                    required
                    value={purBagWeight}
                    onChange={(e) => setPurBagWeight(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="pur-price" className="block text-xs font-medium text-slate-700">
                  Purchase Price per {purUnit === 'bags' ? 'Bag' : 'kg'} (NGN) <span className="text-red-600">*</span>
                </label>
                <input
                  id="pur-price"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={purUnitPrice}
                  onChange={(e) => setPurUnitPrice(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>

              {purPreview && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Standardized Weight:</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {purPreview.kg.toLocaleString()} kg ({purPreview.grams.toLocaleString()} g)
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-slate-600">Total Purchase Cost:</span>
                    <span className="font-mono font-semibold text-emerald-800">
                      {formatNgn(purPreview.totalNgn)} ({formatNgn(purPreview.costPerKg)}/kg)
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="pur-supplier" className="block text-xs font-medium text-slate-700">
                    Supplier (Optional)
                  </label>
                  <input
                    id="pur-supplier"
                    type="text"
                    maxLength={120}
                    value={purSupplier}
                    onChange={(e) => setPurSupplier(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="pur-ref" className="block text-xs font-medium text-slate-700">
                    Invoice / Receipt Ref (Optional)
                  </label>
                  <input
                    id="pur-ref"
                    type="text"
                    maxLength={80}
                    value={purRef}
                    onChange={(e) => setPurRef(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="pur-remarks" className="block text-xs font-medium text-slate-700">
                  Remarks
                </label>
                <textarea
                  id="pur-remarks"
                  rows={2}
                  maxLength={500}
                  value={purRemarks}
                  onChange={(e) => setPurRemarks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setPurchaseModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={purSubmitting}
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
                >
                  {purSubmitting ? 'Saving...' : 'Save Purchase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Consumption Modal */}
      {consumptionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">
                {editingConsumption ? 'Edit Feed Consumption Notes' : 'Record Feed Consumption (Stock-Out)'}
              </h2>
              <button
                type="button"
                onClick={() => setConsumptionModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleConsumptionSubmit} className="mt-4 space-y-4">
              {consError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {consError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cons-date" className="block text-xs font-medium text-slate-700">
                    Consumption Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="cons-date"
                    type="date"
                    required
                    value={consDate}
                    onChange={(e) => setConsDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="cons-time" className="block text-xs font-medium text-slate-700">
                    Time (Optional)
                  </label>
                  <input
                    id="cons-time"
                    type="time"
                    value={consTime}
                    onChange={(e) => setConsTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              {!editingConsumption && (
                <>
                  <div>
                    <label htmlFor="cons-batch" className="block text-xs font-medium text-slate-700">
                      Active Batch <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="cons-batch"
                      required
                      value={consBatchId}
                      onChange={(e) => setConsBatchId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Select active batch...</option>
                      {activeBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.batchCode} — {b.penNameSnapshot}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="cons-feed" className="block text-xs font-medium text-slate-700">
                      Feed Type &amp; Brand <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="cons-feed"
                      required
                      value={consFeedId}
                      onChange={(e) => setConsFeedId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Select feed...</option>
                      {activeItems.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.feedType} — {i.brand} ({i.defaultBagWeightKg} kg/bag)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="cons-qty" className="block text-xs font-medium text-slate-700">
                        Quantity <span className="text-red-600">*</span>
                      </label>
                      <input
                        id="cons-qty"
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={consQty}
                        onChange={(e) => setConsQty(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label htmlFor="cons-unit" className="block text-xs font-medium text-slate-700">
                        Unit
                      </label>
                      <select
                        id="cons-unit"
                        value={consUnit}
                        onChange={(e) => setConsUnit(e.target.value as FeedUnit)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="bags">Bags</option>
                        <option value="kg">Kilograms (kg)</option>
                      </select>
                    </div>
                  </div>

                  {consPreview && (
                    <div
                      className={`rounded-lg border p-3 text-xs tabular-nums ${
                        consPreview.insufficient || !consPreview.qualifying
                          ? 'border-red-200 bg-red-50 text-red-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex justify-between">
                        <span>Current Available Stock:</span>
                        <span className="font-mono font-semibold">
                          {consPreview.availFormatted.kgText} ({consPreview.availFormatted.bagsText})
                        </span>
                      </div>
                      {consPreview.requestedGrams > 0 && (
                        <div className="mt-1 flex justify-between">
                          <span>Requested Amount:</span>
                          <span className="font-mono font-semibold">
                            {(consPreview.requestedGrams / 1000).toFixed(2)} kg
                          </span>
                        </div>
                      )}
                      {consPreview.insufficient && (
                        <p className="mt-1.5 font-semibold text-red-800">
                          Insufficient stock: cannot issue more than available inventory.
                        </p>
                      )}
                      {consPreview.qualifying ? (
                        <div className="mt-1.5 border-t border-slate-200 pt-1.5">
                          <div className="flex justify-between">
                            <span>Costing Purchase Date (&le; {consDate}):</span>
                            <span className="font-mono">{consPreview.qualifying.purchaseDate}</span>
                          </div>
                          {consPreview.requestedGrams > 0 && (
                            <div className="mt-0.5 flex justify-between font-semibold text-slate-900">
                              <span>Locked Consumption Cost:</span>
                              <span className="font-mono">{formatNgn(consPreview.estimatedCostNgn)}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-1.5 font-semibold text-red-800">
                          No purchase found on or before {consDate} for this feed item.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {editingConsumption && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Quantity ({editingConsumption.enteredQuantity} {editingConsumption.enteredUnit}) and
                  locked historical cost ({formatNgn(editingConsumption.totalCostNgn)}) are preserved.
                  To change quantity or feed item, void this entry and record a new one.
                </div>
              )}

              <div>
                <label htmlFor="cons-remarks" className="block text-xs font-medium text-slate-700">
                  Remarks
                </label>
                <textarea
                  id="cons-remarks"
                  rows={2}
                  maxLength={500}
                  value={consRemarks}
                  onChange={(e) => setConsRemarks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setConsumptionModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    consSubmitting ||
                    (!editingConsumption &&
                      Boolean(consPreview && (consPreview.insufficient || !consPreview.qualifying)))
                  }
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
                >
                  {consSubmitting
                    ? 'Saving...'
                    : editingConsumption
                    ? 'Save Changes'
                    : 'Save Consumption'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmVoidModal
        open={Boolean(voidPurchaseTarget)}
        title="Void Feed Purchase?"
        description={`Voiding this purchase will subtract ${(
          (voidPurchaseTarget?.standardizedGrams || 0) / 1000
        ).toFixed(2)} kg from current stock. Voiding is blocked if stock has already been consumed.`}
        confirmLabel="Void Purchase"
        onConfirm={async (reason) => {
          if (!voidPurchaseTarget) return;
          await voidFeedPurchase({
            farmId: farm.farmId,
            purchase: voidPurchaseTarget,
            voidReason: reason,
            actorUid: member.uid,
            actorName: member.displayName,
          });
          setFeedback({ type: 'success', text: 'Feed purchase voided and stock adjusted.' });
        }}
        onClose={() => setVoidPurchaseTarget(null)}
      />

      <ConfirmVoidModal
        open={Boolean(voidConsTarget)}
        title="Void Feed Consumption?"
        description={`Voiding this consumption entry will restore ${(
          (voidConsTarget?.standardizedGrams || 0) / 1000
        ).toFixed(2)} kg back to current feed stock.`}
        confirmLabel="Void & Restore Stock"
        onConfirm={async (reason) => {
          if (!voidConsTarget) return;
          await voidFeedConsumption({
            farmId: farm.farmId,
            consumption: voidConsTarget,
            voidReason: reason,
            actorUid: member.uid,
            actorName: member.displayName,
          });
          setFeedback({ type: 'success', text: 'Feed consumption voided and stock restored.' });
        }}
        onClose={() => setVoidConsTarget(null)}
      />
    </div>
  );
};
