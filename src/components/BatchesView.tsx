import React, { useMemo, useState } from 'react';
import { Edit2, Plus, PowerOff, Search, X } from 'lucide-react';
import {
  calculateBirdAgeDays,
  formatBirdAge,
  formatDateInTimezone,
  hasPermission,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { createBatch, deactivateBatch, updateBatch } from '../services/batchService.ts';
import type {
  EggProductionEntry,
  Farm,
  FarmMember,
  FeedConsumption,
  Pen,
  PoultryBatch,
} from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';

interface BatchesViewProps {
  farm: Farm;
  member: FarmMember;
  pens: Pen[];
  batches: PoultryBatch[];
  production: EggProductionEntry[];
  consumptions: FeedConsumption[];
}

export const BatchesView: React.FC<BatchesViewProps> = ({
  farm,
  member,
  pens,
  batches,
  production,
  consumptions,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canCreate = hasPermission(member, 'batches', 'create');
  const canEdit = hasPermission(member, 'batches', 'edit');
  const canDelete = hasPermission(member, 'batches', 'delete');

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<PoultryBatch | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PoultryBatch | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form fields
  const [batchCode, setBatchCode] = useState('');
  const [penId, setPenId] = useState('');
  const [birdType, setBirdType] = useState('Layer');
  const [breed, setBreed] = useState('ISA Brown');
  const [source, setSource] = useState('');
  const [ageMode, setAgeMode] = useState<'hatch' | 'placement'>('hatch');
  const [hatchDate, setHatchDate] = useState('');
  const [ageAtPlacementDays, setAgeAtPlacementDays] = useState('126');
  const [placementDate, setPlacementDate] = useState(todayStr);
  const [initialCount, setInitialCount] = useState('');
  const [maleCount, setMaleCount] = useState('0');
  const [femaleCount, setFemaleCount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filteredBatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return batches.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (!q) return true;
      return (
        b.batchCode.toLowerCase().includes(q) ||
        b.penNameSnapshot.toLowerCase().includes(q) ||
        b.breed.toLowerCase().includes(q)
      );
    });
  }, [batches, statusFilter, searchQuery]);

  const openCreateModal = () => {
    const freePen = pens.find((p) => p.status === 'active' && !p.activeBatchId);
    setEditingBatch(null);
    setBatchCode('');
    setPenId(freePen?.id || '');
    setBirdType('Layer');
    setBreed('ISA Brown');
    setSource('');
    setAgeMode('hatch');
    setHatchDate('');
    setAgeAtPlacementDays('126');
    setPlacementDate(todayStr);
    setInitialCount('');
    setMaleCount('0');
    setFemaleCount('');
    setRemarks('');
    setStatus('active');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (b: PoultryBatch) => {
    setEditingBatch(b);
    setBatchCode(b.batchCode);
    setPenId(b.penId);
    setBirdType(b.birdType);
    setBreed(b.breed);
    setSource(b.source);
    setAgeMode(b.hatchDate ? 'hatch' : 'placement');
    setHatchDate(b.hatchDate);
    setAgeAtPlacementDays(String(b.ageAtPlacementDays));
    setPlacementDate(b.placementDate);
    setInitialCount(String(b.initialCount));
    setMaleCount(String(b.maleCount));
    setFemaleCount(String(b.femaleCount));
    setRemarks(b.remarks);
    setStatus(b.status);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const initNum = parseInt(initialCount, 10);
      const maleNum = parseInt(maleCount || '0', 10);
      const femaleNum = femaleCount === '' ? initNum - maleNum : parseInt(femaleCount, 10);
      const ageDays = ageMode === 'hatch' ? 0 : parseInt(ageAtPlacementDays || '0', 10);

      if (ageMode === 'hatch' && !hatchDate) {
        throw new Error('Please enter a hatch date or switch to "Age at Placement".');
      }

      if (editingBatch) {
        await updateBatch({
          farmId: farm.farmId,
          batch: editingBatch,
          penId,
          birdType,
          breed,
          source,
          hatchDate: ageMode === 'hatch' ? hatchDate : '',
          ageAtPlacementDays: ageDays,
          placementDate,
          initialCount: initNum,
          maleCount: maleNum,
          femaleCount: femaleNum,
          remarks,
          status,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Batch "${editingBatch.batchCode}" updated.` });
      } else {
        await createBatch({
          farmId: farm.farmId,
          batchCode,
          penId,
          birdType,
          breed,
          source,
          hatchDate: ageMode === 'hatch' ? hatchDate : '',
          ageAtPlacementDays: ageDays,
          placementDate,
          initialCount: initNum,
          maleCount: maleNum,
          femaleCount: femaleNum,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Batch "${batchCode.trim()}" created and placed.` });
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(formatUserFriendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const batchMetrics = useMemo(() => {
    const map = new Map<string, { eggs: number; feedKg: number }>();
    for (const p of production) {
      if (p.isVoided) continue;
      const cur = map.get(p.batchId) || { eggs: 0, feedKg: 0 };
      cur.eggs += p.totalEggs;
      map.set(p.batchId, cur);
    }
    for (const c of consumptions) {
      if (c.isVoided) continue;
      const cur = map.get(c.batchId) || { eggs: 0, feedKg: 0 };
      cur.feedKg += c.standardizedGrams / 1000;
      map.set(c.batchId, cur);
    }
    return map;
  }, [production, consumptions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Flocks &amp; Batches</h1>
          <p className="mt-1 text-xs text-slate-500">
            Active batches appear in daily recording selectors; inactive batches preserve full history.
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            disabled={pens.filter((p) => p.status === 'active').length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Place New Batch</span>
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

      {pens.filter((p) => p.status === 'active').length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No active pens/houses exist yet. Create at least one pen in Farm Setup before placing a batch.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
          {(['all', 'active', 'inactive'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search batch code, pen, breed..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-emerald-700 focus:outline-none"
          />
        </div>
      </div>

      {/* Batches Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {filteredBatches.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-800">No batches match your filter.</p>
            <p className="mt-1 text-xs text-slate-500">
              Place your first poultry layer batch to begin tracking egg production and feed intake.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 font-medium">Batch Code</th>
                  <th className="px-4 py-3 font-medium">Pen</th>
                  <th className="px-4 py-3 font-medium">Breed / Source</th>
                  <th className="px-4 py-3 font-medium">Placement</th>
                  <th className="px-4 py-3 font-medium">Age Today</th>
                  <th className="px-4 py-3 text-right font-medium">Initial Birds</th>
                  <th className="px-4 py-3 text-right font-medium">Eggs Logged</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {filteredBatches.map((b) => {
                  let ageTodayText = '—';
                  try {
                    if (todayStr >= b.placementDate) {
                      const days = calculateBirdAgeDays({
                        hatchDate: b.hatchDate,
                        placementDate: b.placementDate,
                        ageAtPlacementDays: b.ageAtPlacementDays,
                        transactionDate: todayStr,
                      });
                      ageTodayText = formatBirdAge(days);
                    } else {
                      ageTodayText = 'Pre-placement';
                    }
                  } catch {
                    ageTodayText = 'Check dates';
                  }
                  const metrics = batchMetrics.get(b.id) || { eggs: 0, feedKg: 0 };

                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div>{b.batchCode}</div>
                        <div className="font-normal text-slate-500">{b.birdType}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{b.penNameSnapshot}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{b.breed || '—'}</div>
                        <div className="text-slate-400">{b.source || '—'}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700">{b.placementDate}</td>
                      <td className="px-4 py-3 font-mono text-slate-700">{ageTodayText}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-900">
                        {b.initialCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {metrics.eggs.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-medium ${
                            b.status === 'active' ? 'text-emerald-800' : 'text-slate-500'
                          }`}
                        >
                          {b.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(b)}
                              className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                              title="Edit batch"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {b.status === 'active' && (canDelete || canEdit) && (
                            <button
                              type="button"
                              onClick={() => setDeactivateTarget(b)}
                              className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                              title="Deactivate batch"
                            >
                              <PowerOff className="h-3.5 w-3.5" />
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

      {/* Create / Edit Batch Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">
                {editingBatch ? `Edit Batch: ${editingBatch.batchCode}` : 'Place New Poultry Batch'}
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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="batch-code" className="block text-xs font-medium text-slate-700">
                    Unique Batch Code <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="batch-code"
                    type="text"
                    required
                    disabled={Boolean(editingBatch)}
                    value={batchCode}
                    onChange={(e) => setBatchCode(e.target.value)}
                    placeholder="e.g. LYR-2026-01"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label htmlFor="batch-pen" className="block text-xs font-medium text-slate-700">
                    Pen / House <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="batch-pen"
                    required
                    value={penId}
                    onChange={(e) => setPenId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select pen...</option>
                    {pens
                      .filter((p) => p.status === 'active' || p.id === editingBatch?.penId)
                      .map((p) => {
                        const occupiedByOther =
                          p.activeBatchId && p.activeBatchId !== editingBatch?.id;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.code})
                            {occupiedByOther ? ' — Occupied' : ''}
                          </option>
                        );
                      })}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="bird-type" className="block text-xs font-medium text-slate-700">
                    Bird Type
                  </label>
                  <input
                    id="bird-type"
                    type="text"
                    required
                    value={birdType}
                    onChange={(e) => setBirdType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="bird-breed" className="block text-xs font-medium text-slate-700">
                    Breed / Strain
                  </label>
                  <input
                    id="bird-breed"
                    type="text"
                    value={breed}
                    onChange={(e) => setBreed(e.target.value)}
                    placeholder="e.g. ISA Brown"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="bird-source" className="block text-xs font-medium text-slate-700">
                    Hatchery / Source
                  </label>
                  <input
                    id="bird-source"
                    type="text"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="Optional supplier"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="placement-date" className="block text-xs font-medium text-slate-700">
                    Placement Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="placement-date"
                    type="date"
                    required
                    value={placementDate}
                    onChange={(e) => setPlacementDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Age Reference Method
                  </label>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAgeMode('hatch')}
                      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                        ageMode === 'hatch'
                          ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                          : 'border-slate-300 text-slate-600'
                      }`}
                    >
                      Hatch Date
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgeMode('placement')}
                      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                        ageMode === 'placement'
                          ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                          : 'border-slate-300 text-slate-600'
                      }`}
                    >
                      Age at Placement
                    </button>
                  </div>
                </div>
              </div>

              {ageMode === 'hatch' ? (
                <div>
                  <label htmlFor="hatch-date" className="block text-xs font-medium text-slate-700">
                    Hatch Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="hatch-date"
                    type="date"
                    required
                    value={hatchDate}
                    onChange={(e) => setHatchDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="age-days" className="block text-xs font-medium text-slate-700">
                    Age at Placement (Days) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="age-days"
                    type="number"
                    min={0}
                    max={2000}
                    required
                    value={ageAtPlacementDays}
                    onChange={(e) => setAgeAtPlacementDays(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="init-count" className="block text-xs font-medium text-slate-700">
                    Initial Bird Count <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="init-count"
                    type="number"
                    min={1}
                    required
                    value={initialCount}
                    onChange={(e) => setInitialCount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="female-count" className="block text-xs font-medium text-slate-700">
                    Female Count (Opt.)
                  </label>
                  <input
                    id="female-count"
                    type="number"
                    min={0}
                    value={femaleCount}
                    onChange={(e) => setFemaleCount(e.target.value)}
                    placeholder="Defaults to remainder"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="male-count" className="block text-xs font-medium text-slate-700">
                    Male Count (Opt.)
                  </label>
                  <input
                    id="male-count"
                    type="number"
                    min={0}
                    value={maleCount}
                    onChange={(e) => setMaleCount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              {editingBatch && (
                <div>
                  <label htmlFor="batch-status" className="block text-xs font-medium text-slate-700">
                    Batch Status
                  </label>
                  <select
                    id="batch-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="active">Active (Selectable for daily entries)</option>
                    <option value="inactive">Inactive (Archived; releases pen)</option>
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="batch-remarks" className="block text-xs font-medium text-slate-700">
                  Remarks
                </label>
                <textarea
                  id="batch-remarks"
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
                  {submitting ? 'Saving...' : editingBatch ? 'Save Changes' : 'Create Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmVoidModal
        open={Boolean(deactivateTarget)}
        title={`Deactivate Batch ${deactivateTarget?.batchCode || ''}?`}
        description="Deactivating frees the assigned pen for future flocks and excludes this batch from new production or feed entry selectors. Existing production and feed records remain completely intact."
        confirmLabel="Deactivate Batch"
        requireReason={false}
        onConfirm={async () => {
          if (!deactivateTarget) return;
          await deactivateBatch({
            farmId: farm.farmId,
            batch: deactivateTarget,
            actorUid: member.uid,
            actorName: member.displayName,
          });
          setFeedback({
            type: 'success',
            text: `Batch "${deactivateTarget.batchCode}" marked inactive.`,
          });
        }}
        onClose={() => setDeactivateTarget(null)}
      />
    </div>
  );
};
