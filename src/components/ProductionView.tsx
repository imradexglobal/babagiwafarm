import React, { useMemo, useState } from 'react';
import { Ban, Edit2, Plus, X } from 'lucide-react';
import {
  EGGS_PER_CRATE,
  calculateBirdAgeDays,
  formatBirdAge,
  formatDateInTimezone,
  formatEggCountInCrates,
  formatIsoDateDisplay,
  hasPermission,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import {
  createEggProduction,
  updateEggProduction,
  voidEggProduction,
} from '../services/productionService.ts';
import type { EggProductionEntry, Farm, FarmMember, PoultryBatch } from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';

interface ProductionViewProps {
  farm: Farm;
  member: FarmMember;
  batches: PoultryBatch[];
  production: EggProductionEntry[];
}

export const ProductionView: React.FC<ProductionViewProps> = ({
  farm,
  member,
  batches,
  production,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canCreate = hasPermission(member, 'production', 'create');
  const canEdit = hasPermission(member, 'production', 'edit');
  const canDelete = hasPermission(member, 'production', 'delete');

  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);

  // Filters
  const [startDate, setStartDate] = useState(`${todayStr.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(todayStr);
  const [batchFilter, setBatchFilter] = useState('all');
  const [showVoided, setShowVoided] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EggProductionEntry | null>(null);
  const [voidTarget, setVoidTarget] = useState<EggProductionEntry | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form inputs
  const [txDate, setTxDate] = useState(todayStr);
  const [txTime, setTxTime] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [crates, setCrates] = useState('0');
  const [pieces, setPieces] = useState('0');
  const [crackedEggs, setCrackedEggs] = useState('0');
  const [damagedEggs, setDamagedEggs] = useState('0');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    return production.filter((entry) => {
      if (!showVoided && entry.isVoided) return false;
      if (startDate && entry.transactionDate < startDate) return false;
      if (endDate && entry.transactionDate > endDate) return false;
      if (batchFilter !== 'all' && entry.batchId !== batchFilter) return false;
      return true;
    });
  }, [production, showVoided, startDate, endDate, batchFilter]);

  const aggregateSummary = useMemo(() => {
    return filteredEntries
      .filter((e) => !e.isVoided)
      .reduce(
        (acc, e) => {
          acc.entries += 1;
          acc.crates += e.crates;
          acc.pieces += e.pieces;
          acc.intactEggs += e.intactEggs;
          acc.crackedEggs += e.crackedEggs;
          acc.damagedEggs += e.damagedEggs;
          acc.totalEggs += e.totalEggs;
          return acc;
        },
        {
          entries: 0,
          crates: 0,
          pieces: 0,
          intactEggs: 0,
          crackedEggs: 0,
          damagedEggs: 0,
          totalEggs: 0,
        }
      );
  }, [filteredEntries]);

  const dailyTotals = useMemo(() => {
    const map = new Map<
      string,
      { date: string; count: number; intact: number; cracked: number; damaged: number; total: number }
    >();
    for (const e of filteredEntries) {
      if (e.isVoided) continue;
      const cur = map.get(e.transactionDate) || {
        date: e.transactionDate,
        count: 0,
        intact: 0,
        cracked: 0,
        damaged: 0,
        total: 0,
      };
      cur.count += 1;
      cur.intact += e.intactEggs;
      cur.cracked += e.crackedEggs;
      cur.damaged += e.damagedEggs;
      cur.total += e.totalEggs;
      map.set(e.transactionDate, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredEntries]);

  const openCreateModal = () => {
    setEditingEntry(null);
    setTxDate(todayStr);
    setTxTime('');
    setSelectedBatchId(activeBatches[0]?.id || '');
    setCrates('0');
    setPieces('0');
    setCrackedEggs('0');
    setDamagedEggs('0');
    setRemarks('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (entry: EggProductionEntry) => {
    setEditingEntry(entry);
    setTxDate(entry.transactionDate);
    setTxTime(entry.transactionTime);
    setSelectedBatchId(entry.batchId);
    setCrates(String(entry.crates));
    setPieces(String(entry.pieces));
    setCrackedEggs(String(entry.crackedEggs));
    setDamagedEggs(String(entry.damagedEggs));
    setRemarks(entry.remarks);
    setFormError(null);
    setModalOpen(true);
  };

  const previewBatch = batchById.get(selectedBatchId);
  const previewAge = useMemo(() => {
    if (!previewBatch || !txDate) return null;
    try {
      const days = calculateBirdAgeDays({
        hatchDate: previewBatch.hatchDate,
        placementDate: previewBatch.placementDate,
        ageAtPlacementDays: previewBatch.ageAtPlacementDays,
        transactionDate: txDate,
      });
      return { ok: true as const, days, text: formatBirdAge(days) };
    } catch (err) {
      return { ok: false as const, text: err instanceof Error ? err.message : String(err) };
    }
  }, [previewBatch, txDate]);

  const previewCounts = useMemo(() => {
    const c = parseInt(crates || '0', 10) || 0;
    const p = parseInt(pieces || '0', 10) || 0;
    const cr = parseInt(crackedEggs || '0', 10) || 0;
    const dm = parseInt(damagedEggs || '0', 10) || 0;
    const intact = Math.max(0, c) * EGGS_PER_CRATE + Math.max(0, p);
    const total = intact + Math.max(0, cr) + Math.max(0, dm);
    return { intact, total };
  }, [crates, pieces, crackedEggs, damagedEggs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const batch = batchById.get(selectedBatchId);
      if (!batch) throw new Error('Please select a valid poultry batch.');

      const c = Number(crates);
      const p = Number(pieces);
      const cr = Number(crackedEggs);
      const dm = Number(damagedEggs);

      if (editingEntry) {
        await updateEggProduction({
          farmId: farm.farmId,
          entry: editingEntry,
          batch,
          transactionDate: txDate,
          transactionTime: txTime,
          crates: c,
          pieces: p,
          crackedEggs: cr,
          damagedEggs: dm,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: 'Production entry updated (sibling entries untouched).' });
      } else {
        await createEggProduction({
          farmId: farm.farmId,
          transactionDate: txDate,
          transactionTime: txTime,
          batch,
          crates: c,
          pieces: p,
          crackedEggs: cr,
          damagedEggs: dm,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({
          type: 'success',
          text: `Recorded ${previewCounts.total} eggs for ${batch.batchCode} on ${txDate}.`,
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
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Egg Production</h1>
          <p className="mt-1 text-xs text-slate-500">
            Multiple independent entries per batch and date are supported (30 eggs = 1 crate).
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            disabled={activeBatches.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Record Egg Collection</span>
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

      {activeBatches.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No active poultry batches found. Place an active batch in Flocks &amp; Batches before
          recording egg production.
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="prod-start" className="block text-xs font-medium text-slate-600">
            From Date
          </label>
          <input
            id="prod-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
          />
        </div>
        <div>
          <label htmlFor="prod-end" className="block text-xs font-medium text-slate-600">
            To Date
          </label>
          <input
            id="prod-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
          />
        </div>
        <div>
          <label htmlFor="prod-batch-filter" className="block text-xs font-medium text-slate-600">
            Batch Filter (Includes History)
          </label>
          <select
            id="prod-batch-filter"
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
          >
            <option value="all">All Batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchCode} ({b.status})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end pb-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showVoided}
              onChange={(e) => setShowVoided(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-800"
            />
            <span>Include voided entries</span>
          </label>
        </div>
      </div>

      {/* Filtered Aggregate Strip */}
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-5 tabular-nums">
        <div>
          <p className="text-xs text-slate-500">Entries</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
            {aggregateSummary.entries}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Intact Eggs</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-emerald-800">
            {aggregateSummary.intactEggs.toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-500">
            {Math.floor(aggregateSummary.intactEggs / 30)} crates + {aggregateSummary.intactEggs % 30} pcs
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Cracked</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-amber-700">
            {aggregateSummary.crackedEggs.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Damaged</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-red-700">
            {aggregateSummary.damagedEggs.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Grand Total Collected</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
            {aggregateSummary.totalEggs.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Daily Aggregate Table */}
      {dailyTotals.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Daily Production Aggregate</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 text-right font-medium">Pickups</th>
                  <th className="py-2 text-right font-medium">Intact</th>
                  <th className="py-2 text-right font-medium">Cracked</th>
                  <th className="py-2 text-right font-medium">Damaged</th>
                  <th className="py-2 text-right font-medium">Total Collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {dailyTotals.map((d) => (
                  <tr key={d.date}>
                    <td className="py-2 font-medium text-slate-900">{formatIsoDateDisplay(d.date)}</td>
                    <td className="py-2 text-right text-slate-600">{d.count}</td>
                    <td className="py-2 text-right text-emerald-800">{formatEggCountInCrates(d.intact)}</td>
                    <td className="py-2 text-right text-amber-700">{formatEggCountInCrates(d.cracked)}</td>
                    <td className="py-2 text-right text-red-700">{formatEggCountInCrates(d.damaged)}</td>
                    <td className="py-2 text-right font-semibold text-slate-900">
                      {formatEggCountInCrates(d.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Individual Entries Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {filteredEntries.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-800">No production entries in this filter.</p>
            <p className="mt-1 text-xs text-slate-500">
              Record a new egg collection or widen the date range above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 font-medium">Date / Time</th>
                  <th className="px-4 py-3 font-medium">Batch / Pen</th>
                  <th className="px-4 py-3 font-medium">Bird Age</th>
                  <th className="px-4 py-3 text-right font-medium">Crates + Pcs</th>
                  <th className="px-4 py-3 text-right font-medium">Intact</th>
                  <th className="px-4 py-3 text-right font-medium">Cracked / Dmg</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Recorded By</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {filteredEntries.map((e) => (
                  <tr key={e.id} className={e.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-mono">
                      <div className={e.isVoided ? 'line-through' : 'font-medium text-slate-900'}>
                        {formatIsoDateDisplay(e.transactionDate)}
                      </div>
                      <div className="text-[11px] text-slate-500">{e.transactionTime || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{e.batchCodeSnapshot}</div>
                      <div className="text-slate-500">{e.penNameSnapshot}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {formatBirdAge(e.birdAgeDaysAtTransaction)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {e.crates}c + {e.pieces}p
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-emerald-800">
                      {e.intactEggs.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {e.crackedEggs} / {e.damagedEggs}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                      {e.totalEggs.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div>{e.createdByName}</div>
                      {e.isVoided && (
                        <div className="text-[11px] font-medium text-red-700">
                          VOIDED: {e.voidReason}
                        </div>
                      )}
                      {!e.isVoided && e.remarks && (
                        <div className="max-w-[180px] truncate text-[11px] text-slate-500" title={e.remarks}>
                          {e.remarks}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!e.isVoided && (
                        <div className="inline-flex items-center gap-2">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(e)}
                              className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                              title="Edit entry"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setVoidTarget(e)}
                              className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                              title="Void entry"
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">
                {editingEntry ? 'Edit Egg Production Entry' : 'Record Egg Production'}
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
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {formError}
                </div>
              )}

              <div>
                <label htmlFor="prod-batch" className="block text-xs font-medium text-slate-700">
                  Active Flock Batch <span className="text-red-600">*</span>
                </label>
                <select
                  id="prod-batch"
                  required
                  value={selectedBatchId}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select active batch...</option>
                  {activeBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchCode} — {b.penNameSnapshot}
                    </option>
                  ))}
                  {editingEntry &&
                    batchById.get(editingEntry.batchId)?.status === 'inactive' && (
                      <option value={editingEntry.batchId}>
                        {editingEntry.batchCodeSnapshot} (Inactive — Historical)
                      </option>
                    )}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="prod-date" className="block text-xs font-medium text-slate-700">
                    Collection Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="prod-date"
                    type="date"
                    required
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="prod-time" className="block text-xs font-medium text-slate-700">
                    Collection Time (Optional)
                  </label>
                  <input
                    id="prod-time"
                    type="time"
                    value={txTime}
                    onChange={(e) => setTxTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              {previewAge && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    previewAge.ok
                      ? 'border-slate-200 bg-slate-50 text-slate-700'
                      : 'border-red-200 bg-red-50 text-red-800'
                  }`}
                >
                  {previewAge.ok ? (
                    <span>
                      Bird Age on {txDate}: <strong className="font-mono">{previewAge.text}</strong>
                    </span>
                  ) : (
                    <span>{previewAge.text}</span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label htmlFor="prod-crates" className="block text-xs font-medium text-slate-700">
                    Crates (×30)
                  </label>
                  <input
                    id="prod-crates"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={crates}
                    onChange={(e) => setCrates(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="prod-pieces" className="block text-xs font-medium text-slate-700">
                    Extra Pieces
                  </label>
                  <input
                    id="prod-pieces"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={pieces}
                    onChange={(e) => setPieces(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="prod-cracked" className="block text-xs font-medium text-slate-700">
                    Cracked
                  </label>
                  <input
                    id="prod-cracked"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={crackedEggs}
                    onChange={(e) => setCrackedEggs(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="prod-damaged" className="block text-xs font-medium text-slate-700">
                    Damaged
                  </label>
                  <input
                    id="prod-damaged"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={damagedEggs}
                    onChange={(e) => setDamagedEggs(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs tabular-nums">
                <span>
                  Intact Eggs:{' '}
                  <strong className="font-mono text-emerald-800">
                    {previewCounts.intact.toLocaleString()}
                  </strong>
                </span>
                <span>
                  Total Collected:{' '}
                  <strong className="font-mono text-slate-900">
                    {previewCounts.total.toLocaleString()}
                  </strong>
                </span>
              </div>

              <div>
                <label htmlFor="prod-remarks" className="block text-xs font-medium text-slate-700">
                  Remarks
                </label>
                <textarea
                  id="prod-remarks"
                  rows={2}
                  maxLength={500}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional pickup notes (e.g. Morning collection)"
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
                  disabled={submitting || (previewAge !== null && !previewAge.ok)}
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
                >
                  {submitting ? 'Saving...' : editingEntry ? 'Save Changes' : 'Save Production'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmVoidModal
        open={Boolean(voidTarget)}
        title="Void Egg Production Entry?"
        description={`This will mark the entry of ${voidTarget?.totalEggs || 0} eggs (${voidTarget?.batchCodeSnapshot || ''} on ${voidTarget?.transactionDate || ''}) as voided and exclude it from totals while retaining audit history.`}
        confirmLabel="Void Entry"
        onConfirm={async (reason) => {
          if (!voidTarget) return;
          await voidEggProduction({
            farmId: farm.farmId,
            entry: voidTarget,
            voidReason: reason,
            actorUid: member.uid,
            actorName: member.displayName,
          });
          setFeedback({ type: 'success', text: 'Egg production entry voided.' });
        }}
        onClose={() => setVoidTarget(null)}
      />
    </div>
  );
};
