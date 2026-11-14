import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Calendar,
  Edit2,
  Moon,
  Plus,
  Sun,
  Sunrise,
  X,
} from 'lucide-react';
import {
  calculateBatchMortalityStats,
  calculateBirdAgeDays,
  formatBirdAge,
  formatDateInTimezone,
  formatIsoDateDisplay,
  hasPermission,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import {
  createMortalityEntry,
  updateMortalityEntry,
  voidMortalityEntry,
} from '../services/mortalityService.ts';
import type {
  Farm,
  FarmMember,
  MortalityEntry,
  PoultryBatch,
  TimeOfDay,
} from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';

export const MORTALITY_REASON_OPTIONS = [
  'Disease / Infection',
  'Heat Stress',
  'Predator / Pest',
  'Cannibalism / Pecking',
  'Prolapse / Egg Bound',
  'Weak / Runt / Cull',
  'Sudden Death',
  'Accident / Injury',
  'Unknown',
  'Others',
] as const;

const TIME_OF_DAY_META: Record<
  TimeOfDay,
  { label: string; badgeClass: string; Icon: React.FC<{ className?: string }> }
> = {
  morning: {
    label: 'Morning',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
    Icon: Sunrise,
  },
  afternoon: {
    label: 'Afternoon',
    badgeClass: 'border-sky-200 bg-sky-50 text-sky-800',
    Icon: Sun,
  },
  night: {
    label: 'Night',
    badgeClass: 'border-indigo-200 bg-indigo-50 text-indigo-800',
    Icon: Moon,
  },
};

interface MortalityViewProps {
  farm: Farm;
  member: FarmMember;
  batches: PoultryBatch[];
  mortalityEntries: MortalityEntry[];
  initialBatchFilter?: string;
  autoOpenRecordModal?: boolean;
  onConsumedAutoOpen?: () => void;
  onBackToBatches?: () => void;
}

export const MortalityView: React.FC<MortalityViewProps> = ({
  farm,
  member,
  batches,
  mortalityEntries,
  initialBatchFilter,
  autoOpenRecordModal,
  onConsumedAutoOpen,
  onBackToBatches,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canCreate =
    hasPermission(member, 'batches', 'create') || hasPermission(member, 'production', 'create');
  const canEdit =
    hasPermission(member, 'batches', 'edit') || hasPermission(member, 'production', 'edit');
  const canDelete =
    hasPermission(member, 'batches', 'delete') || hasPermission(member, 'production', 'delete');

  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);

  // Filters
  const [startDate, setStartDate] = useState(`${todayStr.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(todayStr);
  const [batchFilter, setBatchFilter] = useState(initialBatchFilter || 'all');
  const [timeFilter, setTimeFilter] = useState<'all' | TimeOfDay>('all');
  const [showVoided, setShowVoided] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MortalityEntry | null>(null);
  const [voidTarget, setVoidTarget] = useState<MortalityEntry | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form inputs
  const [txDate, setTxDate] = useState(todayStr);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('morning');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [mortalityCount, setMortalityCount] = useState('1');
  const [reasonCategory, setReasonCategory] = useState<string>('Disease / Infection');
  const [reasonDetail, setReasonDetail] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreateModal = (preselectedBatchId?: string) => {
    const preferredBatch =
      (preselectedBatchId && activeBatches.find((b) => b.id === preselectedBatchId)?.id) ||
      (batchFilter !== 'all' && activeBatches.find((b) => b.id === batchFilter)?.id) ||
      activeBatches[0]?.id ||
      '';
    setEditingEntry(null);
    setTxDate(todayStr);
    setTimeOfDay('morning');
    setSelectedBatchId(preferredBatch);
    setMortalityCount('1');
    setReasonCategory('Disease / Infection');
    setReasonDetail('');
    setRemarks('');
    setFormError(null);
    setModalOpen(true);
  };

  useEffect(() => {
    if (initialBatchFilter) {
      setBatchFilter(initialBatchFilter);
    }
  }, [initialBatchFilter]);

  useEffect(() => {
    if (autoOpenRecordModal) {
      if (canCreate && activeBatches.length > 0) {
        openCreateModal(initialBatchFilter);
      }
      onConsumedAutoOpen?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenRecordModal, initialBatchFilter]);

  const openEditModal = (entry: MortalityEntry) => {
    setEditingEntry(entry);
    setTxDate(entry.transactionDate);
    setTimeOfDay(entry.timeOfDay);
    setSelectedBatchId(entry.batchId);
    setMortalityCount(String(entry.mortalityCount));
    const isStandardReason = (MORTALITY_REASON_OPTIONS as readonly string[]).includes(
      entry.reasonCategory
    );
    setReasonCategory(isStandardReason ? entry.reasonCategory : 'Others');
    setReasonDetail(
      isStandardReason ? entry.reasonDetail : `${entry.reasonCategory}${entry.reasonDetail ? ` — ${entry.reasonDetail}` : ''}`
    );
    setRemarks(entry.remarks);
    setFormError(null);
    setModalOpen(true);
  };

  // All-time batch survival stats
  const batchStatsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateBatchMortalityStats>>();
    for (const b of batches) {
      map.set(b.id, calculateBatchMortalityStats(b, mortalityEntries));
    }
    return map;
  }, [batches, mortalityEntries]);

  const activeFlockTotals = useMemo(() => {
    let initial = 0;
    let losses = 0;
    for (const b of activeBatches) {
      const stats = batchStatsMap.get(b.id);
      if (!stats) continue;
      initial += stats.initialCount;
      losses += stats.totalLosses;
    }
    const surviving = Math.max(0, initial - losses);
    const survivalPct = initial > 0 ? Math.round((surviving / initial) * 10000) / 100 : 0;
    const mortalityPct = initial > 0 ? Math.round((Math.min(losses, initial) / initial) * 10000) / 100 : 0;
    return { initial, losses, surviving, survivalPct, mortalityPct };
  }, [activeBatches, batchStatsMap]);

  const filteredEntries = useMemo(() => {
    return mortalityEntries.filter((entry) => {
      if (!showVoided && entry.isVoided) return false;
      if (startDate && entry.transactionDate < startDate) return false;
      if (endDate && entry.transactionDate > endDate) return false;
      if (batchFilter !== 'all' && entry.batchId !== batchFilter) return false;
      if (timeFilter !== 'all' && entry.timeOfDay !== timeFilter) return false;
      return true;
    });
  }, [mortalityEntries, showVoided, startDate, endDate, batchFilter, timeFilter]);

  const periodSummary = useMemo(() => {
    const reasonCounts = new Map<string, number>();
    let totalLosses = 0;
    let entries = 0;
    let morning = 0;
    let afternoon = 0;
    let night = 0;

    for (const e of filteredEntries) {
      if (e.isVoided) continue;
      entries += 1;
      totalLosses += e.mortalityCount;
      if (e.timeOfDay === 'morning') morning += e.mortalityCount;
      else if (e.timeOfDay === 'afternoon') afternoon += e.mortalityCount;
      else if (e.timeOfDay === 'night') night += e.mortalityCount;
      reasonCounts.set(e.reasonCategory, (reasonCounts.get(e.reasonCategory) || 0) + e.mortalityCount);
    }

    let topReason = '—';
    let topReasonCount = 0;
    for (const [reason, count] of reasonCounts.entries()) {
      if (count > topReasonCount) {
        topReason = reason;
        topReasonCount = count;
      }
    }

    return { entries, totalLosses, morning, afternoon, night, topReason, topReasonCount };
  }, [filteredEntries]);

  const scorecardBatches = useMemo(() => {
    const list =
      batchFilter === 'all' ? batches : batches.filter((b) => b.id === batchFilter);
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return b.placementDate.localeCompare(a.placementDate);
    });
  }, [batches, batchFilter]);

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

  const previewImpact = useMemo(() => {
    if (!previewBatch) return null;
    const stats = batchStatsMap.get(previewBatch.id);
    const existingLosses = stats ? stats.totalLosses : 0;
    const lossesExcludingSelf = editingEntry
      ? Math.max(0, existingLosses - editingEntry.mortalityCount)
      : existingLosses;
    const available = Math.max(0, previewBatch.initialCount - lossesExcludingSelf);
    const countNum = parseInt(mortalityCount || '0', 10);
    const validCount = Number.isInteger(countNum) && countNum >= 1 ? countNum : 0;
    const projectedTotalLosses = lossesExcludingSelf + validCount;
    const projectedSurviving = Math.max(0, previewBatch.initialCount - projectedTotalLosses);
    const projectedSurvivalPct =
      previewBatch.initialCount > 0
        ? Math.round((projectedSurviving / previewBatch.initialCount) * 10000) / 100
        : 0;
    const exceeds = validCount > available;
    return {
      available,
      projectedSurviving,
      projectedSurvivalPct,
      exceeds,
    };
  }, [previewBatch, batchStatsMap, editingEntry, mortalityCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const batch = batchById.get(selectedBatchId);
      if (!batch) throw new Error('Please select a valid poultry batch.');

      const countNum = Number(mortalityCount);

      if (editingEntry) {
        await updateMortalityEntry({
          farmId: farm.farmId,
          entry: editingEntry,
          batch,
          transactionDate: txDate,
          timeOfDay,
          mortalityCount: countNum,
          reasonCategory,
          reasonDetail,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({
          type: 'success',
          text: `Mortality entry updated for ${batch.batchCode} (${formatIsoDateDisplay(txDate)}).`,
        });
      } else {
        await createMortalityEntry({
          farmId: farm.farmId,
          transactionDate: txDate,
          timeOfDay,
          batch,
          mortalityCount: countNum,
          reasonCategory,
          reasonDetail,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({
          type: 'success',
          text: `Logged ${countNum} bird loss(es) (${TIME_OF_DAY_META[timeOfDay].label}) for ${batch.batchCode} in ${batch.penNameSnapshot}.`,
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
          <div className="flex items-center gap-3">
            {onBackToBatches && (
              <button
                type="button"
                onClick={onBackToBatches}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Batches</span>
              </button>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Mortality &amp; Survival Tracking
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Record daily pen losses with time of day and cause of death to monitor flock survival
            percentages.
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={() => openCreateModal()}
            disabled={activeBatches.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Record Daily Mortality</span>
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
          recording daily mortality.
        </div>
      )}

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 tabular-nums">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Active Flocks Survival Rate</p>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-800">
            {activeFlockTotals.survivalPct.toFixed(2)}%
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {activeFlockTotals.surviving.toLocaleString()} /{' '}
            {activeFlockTotals.initial.toLocaleString()} birds surviving
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Period Losses Logged</p>
          <p className="mt-1 font-mono text-2xl font-bold text-red-700">
            {periodSummary.totalLosses.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Across {periodSummary.entries} non-voided{' '}
            {periodSummary.entries === 1 ? 'entry' : 'entries'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Period Losses by Time</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-mono">
            <span className="text-amber-800">
              AM: <strong>{periodSummary.morning}</strong>
            </span>
            <span className="text-sky-800">
              PM: <strong>{periodSummary.afternoon}</strong>
            </span>
            <span className="text-indigo-800">
              Night: <strong>{periodSummary.night}</strong>
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Morning · Afternoon · Night</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Leading Cause (Period)</p>
          <p className="mt-1 text-base font-bold text-slate-900 truncate" title={periodSummary.topReason}>
            {periodSummary.topReason}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {periodSummary.topReasonCount > 0
              ? `${periodSummary.topReasonCount.toLocaleString()} bird(s) attributed`
              : 'No losses in selected period'}
          </p>
        </div>
      </div>

      {/* Batch & Pen Survival Scorecard */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Pen &amp; Batch Survival Scorecard (All-Time Cumulative)
            </h2>
            <p className="text-xs text-slate-500">
              Calculated from initial placement count minus all non-voided mortality entries per
              batch.
            </p>
          </div>
        </div>

        {scorecardBatches.length === 0 ? (
          <p className="py-6 text-xs text-slate-500">No poultry batches found.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Batch</th>
                  <th className="py-2 pr-3 font-medium">Pen / House</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 px-3 text-right font-medium">Initial Birds</th>
                  <th className="py-2 px-3 text-right font-medium">Total Losses</th>
                  <th className="py-2 px-3 text-right font-medium">Surviving</th>
                  <th className="py-2 px-3 text-right font-medium">Mortality %</th>
                  <th className="py-2 px-3 text-right font-medium">Survival %</th>
                  <th className="py-2 pl-3 text-right font-medium">Quick Log</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {scorecardBatches.map((b) => {
                  const stats = batchStatsMap.get(b.id) || {
                    initialCount: b.initialCount,
                    totalLosses: 0,
                    survivingBirds: b.initialCount,
                    mortalityRatePct: 0,
                    survivalRatePct: 100,
                    entryCount: 0,
                  };
                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-900">{b.batchCode}</div>
                        <div className="text-[11px] text-slate-500">{b.birdType}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">{b.penNameSnapshot}</td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`font-medium ${
                            b.status === 'active' ? 'text-emerald-800' : 'text-slate-500'
                          }`}
                        >
                          {b.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-900">
                        {stats.initialCount.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium text-red-700">
                        {stats.totalLosses.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                        {stats.survivingBirds.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-red-700">
                        {stats.mortalityRatePct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-800">
                        {stats.survivalRatePct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {canCreate && b.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => openCreateModal(b.id)}
                            className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 whitespace-nowrap shrink-0"
                          >
                            <Plus className="h-3 w-3" />
                            <span>Log Loss</span>
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filter Toolbar for Daily Log */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor="mort-start" className="block text-xs font-medium text-slate-600">
            From Date
          </label>
          <input
            id="mort-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
          />
        </div>
        <div>
          <label htmlFor="mort-end" className="block text-xs font-medium text-slate-600">
            To Date
          </label>
          <input
            id="mort-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
          />
        </div>
        <div>
          <label htmlFor="mort-batch-filter" className="block text-xs font-medium text-slate-600">
            Batch / Pen
          </label>
          <select
            id="mort-batch-filter"
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
          >
            <option value="all">All Batches &amp; Pens</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchCode} — {b.penNameSnapshot} ({b.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="mort-time-filter" className="block text-xs font-medium text-slate-600">
            Time of Day
          </label>
          <select
            id="mort-time-filter"
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as 'all' | TimeOfDay)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
          >
            <option value="all">All Times</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="night">Night</option>
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

      {/* Daily Mortality Entries Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {filteredEntries.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-800">
              No mortality entries match this filter.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Record daily losses or widen the date range / batch filter above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 font-medium">Date &amp; Time</th>
                  <th className="px-4 py-3 font-medium">Batch / Pen</th>
                  <th className="px-4 py-3 font-medium">Bird Age</th>
                  <th className="px-4 py-3 text-right font-medium">Birds Lost</th>
                  <th className="px-4 py-3 font-medium">Reason for Death</th>
                  <th className="px-4 py-3 font-medium">Recorded By</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {filteredEntries.map((entry) => {
                  const timeMeta = TIME_OF_DAY_META[entry.timeOfDay] || TIME_OF_DAY_META.morning;
                  const TimeIcon = timeMeta.Icon;
                  return (
                    <tr
                      key={entry.id}
                      className={entry.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div
                          className={`font-mono ${
                            entry.isVoided ? 'line-through' : 'font-medium text-slate-900'
                          }`}
                        >
                          {formatIsoDateDisplay(entry.transactionDate)}
                        </div>
                        <div className="mt-1">
                          <span
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${timeMeta.badgeClass}`}
                          >
                            <TimeIcon className="h-3 w-3" />
                            <span>{timeMeta.label}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">
                          {entry.batchCodeSnapshot}
                        </div>
                        <div className="text-slate-500">{entry.penNameSnapshot}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                        {formatBirdAge(entry.birdAgeDaysAtTransaction)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-red-700">
                        {entry.mortalityCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{entry.reasonCategory}</div>
                        {entry.reasonDetail && (
                          <div
                            className="max-w-[220px] truncate text-[11px] text-slate-500"
                            title={entry.reasonDetail}
                          >
                            {entry.reasonDetail}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>{entry.createdByName}</div>
                        {entry.isVoided && (
                          <div className="text-[11px] font-medium text-red-700">
                            VOIDED: {entry.voidReason}
                          </div>
                        )}
                        {!entry.isVoided && entry.remarks && (
                          <div
                            className="max-w-[180px] truncate text-[11px] text-slate-500"
                            title={entry.remarks}
                          >
                            {entry.remarks}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!entry.isVoided && (
                          <div className="inline-flex items-center gap-2">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditModal(entry)}
                                className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                title="Edit mortality entry"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => setVoidTarget(entry)}
                                className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                                title="Void mortality entry"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Mortality Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">
                {editingEntry ? 'Edit Daily Mortality Entry' : 'Record Daily Bird Mortality'}
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
                <label htmlFor="mort-batch" className="block text-xs font-medium text-slate-700">
                  Flock Batch / Pen <span className="text-red-600">*</span>
                </label>
                <select
                  id="mort-batch"
                  required
                  value={selectedBatchId}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select active batch...</option>
                  {activeBatches.map((b) => {
                    const stats = batchStatsMap.get(b.id);
                    const surviving = stats ? stats.survivingBirds : b.initialCount;
                    return (
                      <option key={b.id} value={b.id}>
                        {b.batchCode} — {b.penNameSnapshot} ({surviving.toLocaleString()} surviving)
                      </option>
                    );
                  })}
                  {editingEntry &&
                    batchById.get(editingEntry.batchId)?.status === 'inactive' && (
                      <option value={editingEntry.batchId}>
                        {editingEntry.batchCodeSnapshot} — {editingEntry.penNameSnapshot} (Inactive)
                      </option>
                    )}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="mort-date" className="block text-xs font-medium text-slate-700">
                    Loss Date <span className="text-red-600">*</span>
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="mort-date"
                      type="date"
                      required
                      value={txDate}
                      onChange={(e) => setTxDate(e.target.value)}
                      className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                    />
                    <div className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 peer-focus:border-emerald-700 peer-focus:ring-1 peer-focus:ring-emerald-700">
                      <span>{txDate ? formatIsoDateDisplay(txDate) : 'Select date'}</span>
                      <Calendar className="h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="mort-count" className="block text-xs font-medium text-slate-700">
                    Birds Lost <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="mort-count"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={mortalityCount}
                    onChange={(e) => setMortalityCount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-700">
                  Time of Day <span className="text-red-600">*</span>
                </span>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {(['morning', 'afternoon', 'night'] as const).map((tod) => {
                    const meta = TIME_OF_DAY_META[tod];
                    const Icon = meta.Icon;
                    const active = timeOfDay === tod;
                    return (
                      <button
                        key={tod}
                        type="button"
                        onClick={() => setTimeOfDay(tod)}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          active
                            ? 'border-emerald-800 bg-emerald-800 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{meta.label}</span>
                      </button>
                    );
                  })}
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
                      Bird Age on {formatIsoDateDisplay(txDate)}:{' '}
                      <strong className="font-mono">{previewAge.text}</strong>
                    </span>
                  ) : (
                    <span>{previewAge.text}</span>
                  )}
                </div>
              )}

              {previewImpact && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs tabular-nums ${
                    previewImpact.exceeds
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {previewImpact.exceeds ? (
                    <span>
                      Entered losses exceed surviving flock count (
                      <strong>{previewImpact.available.toLocaleString()}</strong> birds available).
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Post-entry Surviving:{' '}
                        <strong className="font-mono text-slate-900">
                          {previewImpact.projectedSurviving.toLocaleString()}
                        </strong>{' '}
                        / {previewBatch?.initialCount.toLocaleString()}
                      </span>
                      <span>
                        Survival Rate:{' '}
                        <strong className="font-mono text-emerald-800">
                          {previewImpact.projectedSurvivalPct.toFixed(2)}%
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="mort-reason" className="block text-xs font-medium text-slate-700">
                  Reason for Death <span className="text-red-600">*</span>
                </label>
                <select
                  id="mort-reason"
                  required
                  value={reasonCategory}
                  onChange={(e) => setReasonCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {MORTALITY_REASON_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="mort-detail" className="block text-xs font-medium text-slate-700">
                  Suspected Cause / Clinical Signs{' '}
                  {reasonCategory === 'Others' ? (
                    <span className="text-red-600">*</span>
                  ) : (
                    '(Optional)'
                  )}
                </label>
                <input
                  id="mort-detail"
                  type="text"
                  required={reasonCategory === 'Others'}
                  maxLength={300}
                  value={reasonDetail}
                  onChange={(e) => setReasonDetail(e.target.value)}
                  placeholder={
                    reasonCategory === 'Others'
                      ? 'Specify reason for death...'
                      : 'e.g. Respiratory distress, Newcastle symptoms, heat exhaustion...'
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="mort-remarks" className="block text-xs font-medium text-slate-700">
                  Additional Remarks
                </label>
                <textarea
                  id="mort-remarks"
                  rows={2}
                  maxLength={500}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional inspection or disposal notes"
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
                  disabled={
                    submitting ||
                    (previewAge !== null && !previewAge.ok) ||
                    (previewImpact !== null && previewImpact.exceeds)
                  }
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
                >
                  {submitting
                    ? 'Saving...'
                    : editingEntry
                    ? 'Save Changes'
                    : 'Save Mortality Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmVoidModal
        open={Boolean(voidTarget)}
        title="Void Mortality Entry?"
        description={`This will mark the mortality entry of ${voidTarget?.mortalityCount || 0} bird(s) (${voidTarget?.batchCodeSnapshot || ''} on ${voidTarget ? formatIsoDateDisplay(voidTarget.transactionDate) : ''}) as voided and restore them to calculated surviving flock counts while retaining full audit history.`}
        confirmLabel="Void Entry"
        onConfirm={async (reason) => {
          if (!voidTarget) return;
          await voidMortalityEntry({
            farmId: farm.farmId,
            entry: voidTarget,
            voidReason: reason,
            actorUid: member.uid,
            actorName: member.displayName,
          });
          setFeedback({ type: 'success', text: 'Mortality entry voided.' });
        }}
        onClose={() => setVoidTarget(null)}
      />
    </div>
  );
};
