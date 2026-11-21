import React, { useMemo, useState } from 'react';
import { Award, Calendar, CheckCircle2, Edit2, FileText, HeartPulse, Plus, PowerOff, RotateCcw, Search, X } from 'lucide-react';
import {
  calculateBatchFinancialSummaries,
  calculateBatchMortalityStats,
  calculateBirdAgeDays,
  calculateCostPerEgg,
  calculateCostPerKgBodyWeight,
  calculateFeedConversionRatio,
  calculateHenDayRate,
  formatBirdAge,
  formatDateInTimezone,
  formatEggCountInCrates,
  formatIsoDateDisplay,
  formatNgn,
  generateAutoBatchCode,
  hasPermission,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { archiveUnusedBatch, closeoutBatch, createBatch, deactivateBatch, updateBatch } from '../services/batchService.ts';
import { getCarePlanItemsForPlans } from '../services/carePlanService.ts';
import { materializeCarePlanReminders } from '../services/remindersService.ts';
import type {
  CarePlan,
  EggProductionEntry,
  EggSale,
  Farm,
  FarmMember,
  FarmPurchase,
  FeedConsumption,
  MortalityEntry,
  Pen,
  PoultryBatch,
} from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';

const BIRD_TYPE_OPTIONS = [
  'Layer',
  'Pullet',
  'Point of Lay',
  'Day-Old Chick',
  'Broiler',
  'Cockerel',
  'Noiler',
  'Parent Stock / Breeder',
] as const;

const BREED_OPTIONS = [
  'ISA Brown',
  'Lohmann Brown',
  'Lohmann White',
  'Hy-Line Brown',
  'Hy-Line W-36',
  'Bovans Brown',
  'Bovans Black',
  'Harco Black',
  'Shaver Brown',
  'Novogen Brown',
  'Dominant Black',
  'Cobb 500',
  'Ross 308',
  'Arbor Acres',
  'Marshal',
  'Noiler',
  'Kuroiler',
] as const;

const STRAIN_OPTIONS = [
  'ISA Brown',
  'Lohmann Brown Classic',
  'Lohmann Brown Lite',
  'Lohmann LSL-Lite',
  'Hy-Line Brown',
  'Hy-Line W-36',
  'Hy-Line W-80',
  'Bovans Brown',
  'Bovans Nera',
  'Novogen Brown',
  'Shaver Brown',
  'Harco Black',
  'Dominant CZ',
  'Cobb 500',
  'Ross 308',
  'Arbor Acres Plus',
  'Standard Commercial',
] as const;

interface BatchesViewProps {
  farm: Farm;
  member: FarmMember;
  pens: Pen[];
  batches: PoultryBatch[];
  production: EggProductionEntry[];
  consumptions: FeedConsumption[];
  sales: EggSale[];
  farmPurchases: FarmPurchase[];
  mortalityEntries: MortalityEntry[];
  carePlans?: CarePlan[];
  onOpenMortality: (batchId?: string, openModal?: boolean) => void;
}

export const BatchesView: React.FC<BatchesViewProps> = ({
  farm,
  member,
  pens,
  batches,
  production,
  consumptions,
  sales,
  farmPurchases,
  mortalityEntries,
  carePlans = [],
  onOpenMortality,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canCreate = hasPermission(member, 'batches', 'create');
  const canEdit = hasPermission(member, 'batches', 'edit');
  const canDelete = hasPermission(member, 'batches', 'delete');
  const canLogMortality =
    hasPermission(member, 'batches', 'create') || hasPermission(member, 'production', 'create');

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<PoultryBatch | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PoultryBatch | null>(null);
  const [closeoutTarget, setCloseoutTarget] = useState<PoultryBatch | null>(null);
  const [viewingCloseoutBatch, setViewingCloseoutBatch] = useState<PoultryBatch | null>(null);
  const [closeoutDate, setCloseoutDate] = useState(todayStr);
  const [closeoutLiveCount, setCloseoutLiveCount] = useState('');
  const [closeoutReason, setCloseoutReason] = useState<NonNullable<PoultryBatch['closeoutReason']>>('spent_sold');
  const [closeoutAvgWeight, setCloseoutAvgWeight] = useState('1.8');
  const [closeoutSubmitting, setCloseoutSubmitting] = useState(false);
  const [closeoutError, setCloseoutError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form fields
  const [batchCode, setBatchCode] = useState('');
  const [batchCodeManual, setBatchCodeManual] = useState(false);
  const [penId, setPenId] = useState('');
  const [birdTypeChoice, setBirdTypeChoice] = useState<string>('Layer');
  const [customBirdType, setCustomBirdType] = useState('');
  const [breedChoice, setBreedChoice] = useState<string>('ISA Brown');
  const [customBreed, setCustomBreed] = useState('');
  const [strainChoice, setStrainChoice] = useState<string>('ISA Brown');
  const [customStrain, setCustomStrain] = useState('');
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
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const existingBatchCodes = useMemo(() => batches.map((b) => b.batchCode), [batches]);

  const computeAutoBatchCode = (targetPenId: string, targetDate: string) => {
    const targetPen = pens.find((p) => p.id === targetPenId);
    if (!targetPen || !targetDate) return '';
    return generateAutoBatchCode(targetPen.code || targetPen.name, targetDate, existingBatchCodes);
  };

  const filteredBatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return batches.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (!q) return true;
      return (
        b.batchCode.toLowerCase().includes(q) ||
        b.penNameSnapshot.toLowerCase().includes(q) ||
        b.breed.toLowerCase().includes(q) ||
        (b.strain || '').toLowerCase().includes(q)
      );
    });
  }, [batches, statusFilter, searchQuery]);

  const openCreateModal = () => {
    const freePen = pens.find((p) => p.status === 'active' && !p.activeBatchId);
    const initialPenId = freePen?.id || '';
    const autoCode = freePen
      ? generateAutoBatchCode(freePen.code || freePen.name, todayStr, existingBatchCodes)
      : '';
    setEditingBatch(null);
    setBatchCode(autoCode);
    setBatchCodeManual(false);
    setPenId(initialPenId);
    setBirdTypeChoice('Layer');
    setCustomBirdType('');
    setBreedChoice('ISA Brown');
    setCustomBreed('');
    setStrainChoice('ISA Brown');
    setCustomStrain('');
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
    setSelectedPlanIds([]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (b: PoultryBatch) => {
    const isStdBirdType = (BIRD_TYPE_OPTIONS as readonly string[]).includes(b.birdType);
    const isStdBreed = b.breed === '' || (BREED_OPTIONS as readonly string[]).includes(b.breed);
    const strainVal = b.strain || '';
    const isStdStrain = strainVal === '' || (STRAIN_OPTIONS as readonly string[]).includes(strainVal);

    setEditingBatch(b);
    setBatchCode(b.batchCode);
    setBatchCodeManual(true);
    setPenId(b.penId);
    setBirdTypeChoice(isStdBirdType ? b.birdType : 'Others');
    setCustomBirdType(isStdBirdType ? '' : b.birdType);
    setBreedChoice(isStdBreed ? b.breed : 'Others');
    setCustomBreed(isStdBreed ? '' : b.breed);
    setStrainChoice(isStdStrain ? strainVal : 'Others');
    setCustomStrain(isStdStrain ? '' : strainVal);
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
    setSelectedPlanIds(b.assignedCarePlanIds || []);
    setFormError(null);
    setModalOpen(true);
  };

  const handlePenChange = (nextPenId: string) => {
    setPenId(nextPenId);
    if (!editingBatch && !batchCodeManual) {
      setBatchCode(computeAutoBatchCode(nextPenId, placementDate));
    }
  };

  const handlePlacementDateChange = (nextDate: string) => {
    setPlacementDate(nextDate);
    if (!editingBatch && !batchCodeManual) {
      setBatchCode(computeAutoBatchCode(penId, nextDate));
    }
  };

  const handleResetAutoBatchCode = () => {
    setBatchCodeManual(false);
    setBatchCode(computeAutoBatchCode(penId, placementDate));
  };

  const handleDeleteBatch = async (batch: PoultryBatch) => {
    if (!window.confirm('Archive unused batch "' + batch.batchCode + '"? The batch will be marked inactive; its code and history will be preserved.')) return;
    try { await archiveUnusedBatch({ farmId: farm.farmId, batch, actorUid: member.uid, actorName: member.displayName }); }
    catch (err) { setFeedback({ type: 'error', text: formatUserFriendlyError(err) }); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const resolvedBirdType = (
        birdTypeChoice === 'Others' ? customBirdType : birdTypeChoice
      ).trim();
      const resolvedBreed = (breedChoice === 'Others' ? customBreed : breedChoice).trim();
      const resolvedStrain = (strainChoice === 'Others' ? customStrain : strainChoice).trim();

      if (!resolvedBirdType) {
        throw new Error('Please specify the bird type.');
      }
      if (breedChoice === 'Others' && !resolvedBreed) {
        throw new Error('Please specify the custom breed.');
      }
      if (strainChoice === 'Others' && !resolvedStrain) {
        throw new Error('Please specify the custom strain.');
      }

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
          birdType: resolvedBirdType,
          breed: resolvedBreed,
          strain: resolvedStrain,
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
        const newBatchId = await createBatch({
          farmId: farm.farmId,
          batchCode,
          penId,
          birdType: resolvedBirdType,
          breed: resolvedBreed,
          strain: resolvedStrain,
          source,
          hatchDate: ageMode === 'hatch' ? hatchDate : '',
          ageAtPlacementDays: ageDays,
          placementDate,
          initialCount: initNum,
          maleCount: maleNum,
          femaleCount: femaleNum,
          remarks,
          assignedCarePlanIds: selectedPlanIds,
          actorUid: member.uid,
          actorName: member.displayName,
        });

        // Automatically materialize care plan task reminders if plans were selected
        let scheduledCount = 0;
        if (selectedPlanIds.length > 0) {
          try {
            const items = await getCarePlanItemsForPlans(farm.farmId, selectedPlanIds);
            if (items.length > 0) {
              const selectedPlans = carePlans.filter((p) => selectedPlanIds.includes(p.id));
              const targetPen = pens.find((p) => p.id === penId);
              const batchSnapshot: PoultryBatch = {
                id: newBatchId,
                farmId: farm.farmId,
                batchCode: batchCode.trim(),
                penId,
                penNameSnapshot: targetPen?.name || '',
                birdType: resolvedBirdType,
                breed: resolvedBreed,
                strain: resolvedStrain,
                source,
                hatchDate: ageMode === 'hatch' ? hatchDate : '',
                ageAtPlacementDays: ageDays,
                placementDate,
                initialCount: initNum,
                maleCount: maleNum,
                femaleCount: femaleNum,
                remarks,
                status: 'active',
                assignedCarePlanIds: selectedPlanIds,
                createdBy: member.uid,
                createdByName: member.displayName,
                updatedBy: member.uid,
                createdAt: new Date(),
                updatedAt: new Date(),
              };
              scheduledCount = await materializeCarePlanReminders({
                farmId: farm.farmId,
                batch: batchSnapshot,
                carePlans: selectedPlans,
                carePlanItems: items,
                actorUid: member.uid,
                actorName: member.displayName,
                timeZone: farm.timezone,
              });
            }
          } catch (schedErr) {
            console.error('Failed to materialize care plan reminders:', schedErr);
          }
        }

        const successMessage = scheduledCount > 0
          ? `Batch "${batchCode.trim()}" placed with ${scheduledCount} care plan task(s) scheduled.`
          : `Batch "${batchCode.trim()}" created and placed.`;
        setFeedback({ type: 'success', text: successMessage });
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
      if (p.isVoided || (p.status !== undefined && p.status !== 'APPROVED')) continue;
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

  const mortalityStatsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateBatchMortalityStats>>();
    for (const b of batches) {
      map.set(b.id, calculateBatchMortalityStats(b, mortalityEntries));
    }
    return map;
  }, [batches, mortalityEntries]);

  const financialsMap = useMemo(
    () =>
      calculateBatchFinancialSummaries({
        batches,
        production,
        consumptions,
        sales,
        farmPurchases,
      }),
    [batches, production, consumptions, sales, farmPurchases]
  );

  const filteredFinancialTotals = useMemo(() => {
    let revenue = 0;
    let feedExpense = 0;
    let medicationExpense = 0;
    let otherDirectExpense = 0;
    let netProfit = 0;
    for (const b of filteredBatches) {
      const f = financialsMap.get(b.id);
      if (!f) continue;
      revenue += f.totalRevenueNgn;
      feedExpense += f.feedExpenseNgn;
      medicationExpense += f.medicationExpenseNgn;
      otherDirectExpense += f.directOtherExpenseNgn;
      netProfit += f.netProfitNgn;
    }
    const marginPct = revenue > 0 ? Math.round((netProfit / revenue) * 10000) / 100 : 0;
    return { revenue, feedExpense, medicationExpense, otherDirectExpense, netProfit, marginPct };
  }, [filteredBatches, financialsMap]);

  const openCloseoutModal = (b: PoultryBatch) => {
    const mStats = mortalityStatsMap.get(b.id);
    const live = mStats ? mStats.survivingBirds : b.initialCount;
    setCloseoutTarget(b);
    setCloseoutDate(todayStr);
    setCloseoutLiveCount(String(live));
    setCloseoutReason('spent_sold');
    setCloseoutAvgWeight(b.birdType.toLowerCase().includes('broiler') ? '2.5' : '1.8');
    setCloseoutError(null);
  };

  const handleCloseoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closeoutTarget) return;
    setCloseoutError(null);
    setCloseoutSubmitting(true);
    try {
      const liveCount = parseInt(closeoutLiveCount, 10);
      const avgWeight = parseFloat(closeoutAvgWeight);
      const mStats = mortalityStatsMap.get(closeoutTarget.id) || {
        initialCount: closeoutTarget.initialCount,
        totalLosses: 0,
        survivingBirds: liveCount,
        mortalityRatePct: 0,
        survivalRatePct: 100,
        entryCount: 0,
      };
      const metrics = batchMetrics.get(closeoutTarget.id) || { eggs: 0, feedKg: 0 };
      const fin = financialsMap.get(closeoutTarget.id) || {
        batchId: closeoutTarget.id,
        eggsProduced: metrics.eggs,
        directSalesRevenueNgn: 0,
        pooledSalesRevenueNgn: 0,
        totalRevenueNgn: 0,
        feedExpenseNgn: 0,
        medicationExpenseNgn: 0,
        directOtherExpenseNgn: 0,
        totalExpenseNgn: 0,
        netProfitNgn: 0,
        profitMarginPct: 0,
      };
      const isBroiler = closeoutTarget.birdType.toLowerCase().includes('broiler');
      const prodMetric = isBroiler ? liveCount * avgWeight : metrics.eggs;
      const lifetimeFcr = calculateFeedConversionRatio(metrics.feedKg, prodMetric, isBroiler ? 'broiler' : 'layer');
      const costPerEggNgn = calculateCostPerEgg(fin.totalExpenseNgn, metrics.eggs);
      const costPerKgBodyWeightNgn = calculateCostPerKgBodyWeight(fin.totalExpenseNgn, liveCount, avgWeight);

      await closeoutBatch({
        farmId: farm.farmId,
        batch: closeoutTarget,
        closedDate: closeoutDate,
        finalLiveBirdCount: liveCount,
        closeoutReason,
        averageBirdWeightKg: avgWeight,
        summary: {
          totalIntactEggs: metrics.eggs,
          totalFeedKg: metrics.feedKg,
          totalMortality: mStats.totalLosses,
          mortalityRatePct: mStats.mortalityRatePct,
          totalRevenueNgn: fin.totalRevenueNgn,
          totalExpenseNgn: fin.totalExpenseNgn,
          netProfitNgn: fin.netProfitNgn,
          costPerEggNgn,
          costPerKgBodyWeightNgn,
          lifetimeFcr,
        },
        member,
      });

      setFeedback({ type: 'success', text: `Flock ${closeoutTarget.batchCode} successfully closed out and pen released.` });
      setCloseoutTarget(null);
    } catch (err) {
      setCloseoutError(formatUserFriendlyError(err));
    } finally {
      setCloseoutSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Flocks &amp; Batches</h1>
          <p className="mt-1 text-xs text-slate-500">
            Active batches appear in daily recording selectors; inactive batches preserve full history.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onOpenMortality()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <HeartPulse className="h-4 w-4 text-emerald-800" />
            <span>Mortality &amp; Survival</span>
          </button>

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

      {/* Batch Financials Summary Strip */}
      {filteredBatches.length > 0 && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 tabular-nums">
            <div>
              <p className="text-xs text-slate-500">Egg Sales Revenue (Filtered)</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {formatNgn(filteredFinancialTotals.revenue)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Feed Consumption Cost</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {formatNgn(filteredFinancialTotals.feedExpense)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Medication &amp; Vaccines</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {formatNgn(filteredFinancialTotals.medicationExpense)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Other Batch Purchases</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {formatNgn(filteredFinancialTotals.otherDirectExpense)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Real-Time Net Profitability</p>
              <p
                className={`mt-0.5 font-mono text-lg font-bold ${
                  filteredFinancialTotals.netProfit >= 0 ? 'text-emerald-800' : 'text-red-700'
                }`}
              >
                {formatNgn(filteredFinancialTotals.netProfit)}{' '}
                <span className="text-xs font-semibold">
                  ({filteredFinancialTotals.marginPct.toFixed(1)}%)
                </span>
              </p>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Revenue combines direct batch-tagged egg sales plus pooled farm sales allocated by each batch&apos;s share of eggs produced. Costs show feed, batch-tagged medication/vaccination/supplement purchases, and other direct purchases separately; unassigned purchases are excluded.
          </p>
        </div>
      )}

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
          <>
            {/* Mobile Card Stack */}
            <div className="lg:hidden divide-y divide-slate-100 p-3 space-y-3">
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
                const mStats = mortalityStatsMap.get(b.id) || {
                  initialCount: b.initialCount,
                  totalLosses: 0,
                  survivingBirds: b.initialCount,
                  mortalityRatePct: 0,
                  survivalRatePct: 100,
                  entryCount: 0,
                };
                const fin = financialsMap.get(b.id) || {
                  batchId: b.id,
                  eggsProduced: metrics.eggs,
                  directSalesRevenueNgn: 0,
                  pooledSalesRevenueNgn: 0,
                  totalRevenueNgn: 0,
                  feedExpenseNgn: 0,
                  medicationExpenseNgn: 0,
                  directOtherExpenseNgn: 0,
                  totalExpenseNgn: 0,
                  netProfitNgn: 0,
                  profitMarginPct: 0,
                };

                return (
                  <div key={b.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-slate-900">{b.batchCode}</span>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {b.penNameSnapshot}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {b.birdType} · {b.breed || '—'}{b.strain && b.strain !== b.breed ? ` (${b.strain})` : ''}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          b.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {b.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 rounded-lg p-2.5">
                      <div>
                        <span className="text-slate-500 block text-[11px]">Age Today</span>
                        <span className="font-semibold text-slate-800">{ageTodayText}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Placed</span>
                        <span className="font-semibold text-slate-800 font-mono">{formatIsoDateDisplay(b.placementDate)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Surviving Birds</span>
                        <span className="font-semibold text-slate-900 font-mono">
                          {mStats.survivingBirds.toLocaleString()}{' '}
                          <span className="font-normal text-slate-500">/ {mStats.initialCount.toLocaleString()}</span>
                        </span>
                        <span className="block text-[10px] text-emerald-800 font-medium font-mono">
                          {mStats.survivalRatePct.toFixed(1)}% survival ({mStats.totalLosses} lost)
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Eggs Produced</span>
                        <span className="font-semibold text-slate-900 font-mono">
                          {formatEggCountInCrates(metrics.eggs)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 text-xs">
                      <div>
                        <span className="text-slate-500 block text-[10px]">Revenue</span>
                        <span className="font-bold text-slate-900 font-mono">{formatNgn(fin.totalRevenueNgn)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Costs</span>
                        <span className="font-semibold text-slate-700 font-mono">{formatNgn(fin.totalExpenseNgn)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Net Profit</span>
                        <span className={`font-bold font-mono ${fin.netProfitNgn >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                          {formatNgn(fin.netProfitNgn)}
                        </span>
                      </div>
                    </div>

                    {/* Poultry Industry KPIs */}
                    <div className="grid grid-cols-3 gap-2 bg-emerald-50/60 rounded-lg p-2 text-xs border border-emerald-100">
                      <div>
                        <span className="text-slate-500 block text-[10px]">Cost / Egg</span>
                        <span className="font-semibold text-emerald-950 font-mono">
                          {metrics.eggs > 0 ? `₦${calculateCostPerEgg(fin.totalExpenseNgn, metrics.eggs).toFixed(1)}` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">FCR</span>
                        <span className="font-semibold text-emerald-950 font-mono">
                          {calculateFeedConversionRatio(metrics.feedKg, b.birdType.toLowerCase().includes('broiler') ? mStats.survivingBirds * (b.averageBirdWeightKg || 2.0) : metrics.eggs, b.birdType.toLowerCase().includes('broiler') ? 'broiler' : 'layer') > 0
                            ? calculateFeedConversionRatio(metrics.feedKg, b.birdType.toLowerCase().includes('broiler') ? mStats.survivingBirds * (b.averageBirdWeightKg || 2.0) : metrics.eggs, b.birdType.toLowerCase().includes('broiler') ? 'broiler' : 'layer').toFixed(2)
                            : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Cost / kg</span>
                        <span className="font-semibold text-emerald-950 font-mono">
                          {calculateCostPerKgBodyWeight(fin.totalExpenseNgn, mStats.survivingBirds, b.averageBirdWeightKg || 1.8) > 0
                            ? `₦${calculateCostPerKgBodyWeight(fin.totalExpenseNgn, mStats.survivingBirds, b.averageBirdWeightKg || 1.8).toFixed(0)}`
                            : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                      <button
                        type="button"
                        onClick={() => onOpenMortality(b.id, canLogMortality && b.status === 'active')}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                      >
                        <HeartPulse className="h-3.5 w-3.5" />
                        <span>Mortality</span>
                      </button>

                      <div className="flex items-center gap-2">
                        {b.status === 'active' && member.role === 'owner' && (
                          <button
                            type="button"
                            onClick={() => openCloseoutModal(b)}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                            title="Closeout flock"
                          >
                            <Award className="h-3.5 w-3.5" />
                            <span>Closeout</span>
                          </button>
                        )}
                        {b.closeoutSummary && (
                          <button
                            type="button"
                            onClick={() => setViewingCloseoutBatch(b)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            title="View closeout profitability summary"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>Summary</span>
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openEditModal(b)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                        )}
                        {canDelete && b.status === 'active' && !b.closeoutSummary && (
                          <button type="button" onClick={() => void handleDeleteBatch(b)} className="mr-1 inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                            Archive
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDeactivateTarget(b)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            {b.status === 'active' ? (
                              <>
                                <PowerOff className="h-3.5 w-3.5 text-amber-600" />
                                <span>Deactivate</span>
                              </>
                            ) : (
                              <>
                                <RotateCcw className="h-3.5 w-3.5 text-emerald-800" />
                                <span>Reactivate</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 font-medium">Batch Code</th>
                  <th className="px-4 py-3 font-medium">Pen</th>
                  <th className="px-4 py-3 font-medium">Breed / Strain</th>
                  <th className="px-4 py-3 font-medium">Placement</th>
                  <th className="px-4 py-3 font-medium">Age Today</th>
                  <th className="px-4 py-3 text-right font-medium">Surviving / Initial</th>
                  <th className="px-4 py-3 text-right font-medium">Survival / Loss %</th>
                  <th className="px-4 py-3 text-right font-medium">Eggs Logged</th>
                  <th className="px-4 py-3 text-right font-medium">Revenue (Eggs)</th>
                  <th className="px-4 py-3 text-right font-medium">Costs (Feed + Medication + Other)</th>
                  <th className="px-4 py-3 text-right font-medium">Net Profit / Margin</th>
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
                  const mStats = mortalityStatsMap.get(b.id) || {
                    initialCount: b.initialCount,
                    totalLosses: 0,
                    survivingBirds: b.initialCount,
                    mortalityRatePct: 0,
                    survivalRatePct: 100,
                    entryCount: 0,
                  };
                  const fin = financialsMap.get(b.id) || {
                    batchId: b.id,
                    eggsProduced: metrics.eggs,
                    directSalesRevenueNgn: 0,
                    pooledSalesRevenueNgn: 0,
                    totalRevenueNgn: 0,
                    feedExpenseNgn: 0,
                    medicationExpenseNgn: 0,
                    directOtherExpenseNgn: 0,
                    totalExpenseNgn: 0,
                    netProfitNgn: 0,
                    profitMarginPct: 0,
                  };

                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div>{b.batchCode}</div>
                        <div className="font-normal text-slate-500">{b.birdType}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{b.penNameSnapshot}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>
                          {b.breed || '—'}
                          {b.strain && b.strain !== b.breed ? ` · ${b.strain}` : ''}
                        </div>
                        <div className="text-slate-400">{b.source || '—'}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                        {formatIsoDateDisplay(b.placementDate)}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700">{ageTodayText}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        <div className="font-semibold text-slate-900">
                          {mStats.survivingBirds.toLocaleString()}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          of {mStats.initialCount.toLocaleString()} ({mStats.totalLosses.toLocaleString()}{' '}
                          lost)
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <div className="font-semibold text-emerald-800">
                          {mStats.survivalRatePct.toFixed(2)}%
                        </div>
                        <div className="text-[11px] text-red-700">
                          {mStats.mortalityRatePct.toFixed(2)}% loss
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {formatEggCountInCrates(metrics.eggs)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <div className="font-semibold text-slate-900">
                          {formatNgn(fin.totalRevenueNgn)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {fin.directSalesRevenueNgn > 0 && fin.pooledSalesRevenueNgn > 0
                            ? `${formatNgn(fin.directSalesRevenueNgn)} direct`
                            : fin.directSalesRevenueNgn > 0
                            ? 'Direct sales'
                            : fin.pooledSalesRevenueNgn > 0
                            ? 'Pooled share'
                            : 'No sales'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <div className="font-semibold text-slate-900">
                          {formatNgn(fin.totalExpenseNgn)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Feed {formatNgn(fin.feedExpenseNgn)} · {metrics.feedKg.toFixed(1)} kg
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Medication {formatNgn(fin.medicationExpenseNgn)} · Other {formatNgn(fin.directOtherExpenseNgn)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <div
                          className={`font-semibold ${
                            fin.netProfitNgn >= 0 ? 'text-emerald-800' : 'text-red-700'
                          }`}
                        >
                          {formatNgn(fin.netProfitNgn)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {fin.totalRevenueNgn > 0 ? `${fin.profitMarginPct.toFixed(1)}% margin` : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <span
                            className={`font-medium ${
                              b.status === 'active' ? 'text-emerald-800' : 'text-slate-500'
                            }`}
                          >
                            {b.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                          {b.closeoutSummary && (
                            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                              Closed
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {metrics.eggs > 0 && <span>₦{calculateCostPerEgg(fin.totalExpenseNgn, metrics.eggs).toFixed(1)}/egg</span>}
                          {calculateFeedConversionRatio(metrics.feedKg, b.birdType.toLowerCase().includes('broiler') ? mStats.survivingBirds * (b.averageBirdWeightKg || 2.0) : metrics.eggs, b.birdType.toLowerCase().includes('broiler') ? 'broiler' : 'layer') > 0 && (
                            <span className="ml-1 font-mono">FCR: {calculateFeedConversionRatio(metrics.feedKg, b.birdType.toLowerCase().includes('broiler') ? mStats.survivingBirds * (b.averageBirdWeightKg || 2.0) : metrics.eggs, b.birdType.toLowerCase().includes('broiler') ? 'broiler' : 'layer').toFixed(2)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onOpenMortality(b.id, canLogMortality && b.status === 'active')
                            }
                            className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 whitespace-nowrap shrink-0"
                            title={
                              canLogMortality && b.status === 'active'
                                ? 'Log mortality loss for this batch'
                                : 'View mortality history for this batch'
                            }
                          >
                            <HeartPulse className="h-3 w-3" />
                            <span>
                              {canLogMortality && b.status === 'active' ? 'Log Loss' : 'Mortality'}
                            </span>
                          </button>
                          {b.status === 'active' && member.role === 'owner' && (
                            <button
                              type="button"
                              onClick={() => openCloseoutModal(b)}
                              className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                              title="Closeout this flock"
                            >
                              Closeout
                            </button>
                          )}
                          {b.closeoutSummary && (
                            <button
                              type="button"
                              onClick={() => setViewingCloseoutBatch(b)}
                              className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                              title="View closeout profitability summary"
                            >
                              Summary
                            </button>
                          )}
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
          </>
        )}
      </div>

      {/* Create / Edit Batch Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] sm:max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xl pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
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
                  <label htmlFor="batch-pen" className="block text-xs font-medium text-slate-700">
                    Pen / House <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="batch-pen"
                    required
                    value={penId}
                    onChange={(e) => handlePenChange(e.target.value)}
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

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="batch-code" className="block text-xs font-medium text-slate-700">
                      Unique Batch Code <span className="text-red-600">*</span>
                    </label>
                    {!editingBatch && batchCodeManual && (
                      <button
                        type="button"
                        onClick={handleResetAutoBatchCode}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 hover:underline"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Auto</span>
                      </button>
                    )}
                  </div>
                  <input
                    id="batch-code"
                    type="text"
                    required
                    disabled={Boolean(editingBatch)}
                    value={batchCode}
                    onChange={(e) => {
                      setBatchCodeManual(true);
                      setBatchCode(e.target.value);
                    }}
                    placeholder="e.g. PEN-1-261114"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100"
                  />
                  {!editingBatch && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Auto-generated from pen short code &amp; date (e.g. PEN-1-yymmdd)
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="bird-type" className="block text-xs font-medium text-slate-700">
                    Bird Type <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="bird-type"
                    required
                    value={birdTypeChoice}
                    onChange={(e) => setBirdTypeChoice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {BIRD_TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value="Others">Others (Specify)</option>
                  </select>
                  {birdTypeChoice === 'Others' && (
                    <input
                      type="text"
                      required
                      maxLength={60}
                      value={customBirdType}
                      onChange={(e) => setCustomBirdType(e.target.value)}
                      placeholder="Specify bird type..."
                      aria-label="Custom bird type"
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>

                <div>
                  <label htmlFor="bird-breed" className="block text-xs font-medium text-slate-700">
                    Breed
                  </label>
                  <select
                    id="bird-breed"
                    value={breedChoice}
                    onChange={(e) => setBreedChoice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select breed (Optional)...</option>
                    {BREED_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value="Others">Others (Specify)</option>
                  </select>
                  {breedChoice === 'Others' && (
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={customBreed}
                      onChange={(e) => setCustomBreed(e.target.value)}
                      placeholder="Specify breed..."
                      aria-label="Custom breed"
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>

                <div>
                  <label htmlFor="bird-strain" className="block text-xs font-medium text-slate-700">
                    Strain
                  </label>
                  <select
                    id="bird-strain"
                    value={strainChoice}
                    onChange={(e) => setStrainChoice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select strain (Optional)...</option>
                    {STRAIN_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value="Others">Others (Specify)</option>
                  </select>
                  {strainChoice === 'Others' && (
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={customStrain}
                      onChange={(e) => setCustomStrain(e.target.value)}
                      placeholder="Specify strain..."
                      aria-label="Custom strain"
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
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
                  <div className="relative mt-1">
                    <input
                      id="placement-date"
                      type="date"
                      required
                      value={placementDate}
                      onChange={(e) => handlePlacementDateChange(e.target.value)}
                      className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                    />
                    <div className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 peer-focus:border-emerald-700 peer-focus:ring-1 peer-focus:ring-emerald-700">
                      <span>{placementDate ? formatIsoDateDisplay(placementDate) : 'Select date'}</span>
                      <Calendar className="h-4 w-4 text-slate-400" />
                    </div>
                  </div>
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

              {!editingBatch && (
                <div className="space-y-2 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3.5">
                  <div>
                    <span className="block text-xs font-bold text-emerald-950">
                      Assign Schedule / Care Plans
                    </span>
                    <p className="text-[11px] text-emerald-800">
                      Ready-made vaccination, medication, and check tasks will be automatically scheduled for this flock.
                    </p>
                  </div>
                  {carePlans.filter((p) => p.status === 'active').length === 0 ? (
                    <p className="text-xs text-slate-500 italic py-1">
                      No active care plans created yet. You can build ready-made schedules in Farm Setup &rarr; Care Plan Schedules.
                    </p>
                  ) : (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {carePlans
                        .filter((p) => p.status === 'active')
                        .map((plan) => {
                          const checked = selectedPlanIds.includes(plan.id);
                          return (
                            <label
                              key={plan.id}
                              className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-xs transition-colors cursor-pointer ${
                                checked
                                  ? 'border-emerald-600 bg-white ring-1 ring-emerald-600'
                                  : 'border-slate-200 bg-white hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedPlanIds((prev) =>
                                    checked ? prev.filter((id) => id !== plan.id) : [...prev, plan.id]
                                  );
                                }}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-emerald-800"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-slate-900 truncate">{plan.name}</span>
                                  <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-800 shrink-0">
                                    {plan.planType}
                                  </span>
                                </div>
                                {plan.description && (
                                  <p className="mt-0.5 text-[10px] text-slate-500 line-clamp-1">{plan.description}</p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                    </div>
                  )}
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

      {/* CLOSEOUT FLOCK MODAL */}
      {closeoutTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] sm:max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl sm:rounded-xl border border-amber-300 bg-white p-5 sm:p-6 shadow-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
            <div className="flex items-center justify-between border-b border-amber-200 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-2 py-0.5 rounded">Owner Action</span>
                <h2 className="text-lg font-bold text-slate-900 mt-1">Depopulate &amp; Closeout Flock: {closeoutTarget.batchCode}</h2>
                <p className="text-xs text-slate-500">{closeoutTarget.birdType} · {closeoutTarget.penNameSnapshot}</p>
              </div>
              <button
                type="button"
                onClick={() => setCloseoutTarget(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCloseoutSubmit} className="mt-4 space-y-4">
              {closeoutError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {closeoutError}
                </div>
              )}

              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Important:</p>
                <p className="mt-0.5">Closing out this flock permanently sets it to Inactive, releases pen &quot;{closeoutTarget.penNameSnapshot}&quot; for the next batch, and locks a permanent lifetime KPI summary.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="closeout-date" className="block text-xs font-medium text-slate-700">
                    Closeout Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="closeout-date"
                    type="date"
                    required
                    value={closeoutDate}
                    onChange={(e) => setCloseoutDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="closeout-reason" className="block text-xs font-medium text-slate-700">
                    Closeout Reason <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="closeout-reason"
                    value={closeoutReason}
                    onChange={(e) => setCloseoutReason(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="spent_sold">Sold as Spent Hens / Meat</option>
                    <option value="culled">End of Lay / Culled</option>
                    <option value="transferred">Transferred to Another Facility</option>
                    <option value="disease_depopulation">Emergency / Disease Depopulation</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="closeout-live" className="block text-xs font-medium text-slate-700">
                    Final Live Birds Harvested/Counted <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="closeout-live"
                    type="number"
                    min="0"
                    max={closeoutTarget.initialCount}
                    required
                    value={closeoutLiveCount}
                    onChange={(e) => setCloseoutLiveCount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="closeout-weight" className="block text-xs font-medium text-slate-700">
                    Average Live Bird Weight (kg)
                  </label>
                  <input
                    id="closeout-weight"
                    type="number"
                    step="0.05"
                    min="0"
                    max="50"
                    required
                    value={closeoutAvgWeight}
                    onChange={(e) => setCloseoutAvgWeight(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              {/* Calculated Lifetime Summary Preview */}
              {(() => {
                const live = parseInt(closeoutLiveCount, 10) || 0;
                const weight = parseFloat(closeoutAvgWeight) || 0;
                const metrics = batchMetrics.get(closeoutTarget.id) || { eggs: 0, feedKg: 0 };
                const fin = financialsMap.get(closeoutTarget.id) || { totalRevenueNgn: 0, totalExpenseNgn: 0, netProfitNgn: 0 };
                const isBroiler = closeoutTarget.birdType.toLowerCase().includes('broiler');
                const prodMetric = isBroiler ? live * weight : metrics.eggs;
                const fcr = calculateFeedConversionRatio(metrics.feedKg, prodMetric, isBroiler ? 'broiler' : 'layer');
                const costEgg = calculateCostPerEgg(fin.totalExpenseNgn, metrics.eggs);
                const costKg = calculateCostPerKgBodyWeight(fin.totalExpenseNgn, live, weight);

                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
                    <p className="font-semibold text-slate-900 uppercase tracking-wide text-[10px]">Lifetime Snapshot Preview</p>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded bg-white p-2 border border-slate-100">
                        <span className="text-slate-500 block text-[10px]">Total Intact Eggs</span>
                        <span className="font-bold text-slate-900 font-mono">{formatEggCountInCrates(metrics.eggs)}</span>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-100">
                        <span className="text-slate-500 block text-[10px]">Feed Consumed</span>
                        <span className="font-bold text-slate-900 font-mono">{metrics.feedKg.toFixed(1)} kg</span>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-100">
                        <span className="text-slate-500 block text-[10px]">Lifetime FCR</span>
                        <span className="font-bold text-emerald-800 font-mono">{fcr > 0 ? fcr.toFixed(2) : '—'}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded bg-white p-2 border border-slate-100">
                        <span className="text-slate-500 block text-[10px]">Cost / Egg</span>
                        <span className="font-bold text-slate-900 font-mono">{costEgg > 0 ? `₦${costEgg.toFixed(1)}` : '—'}</span>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-100">
                        <span className="text-slate-500 block text-[10px]">Cost / kg</span>
                        <span className="font-bold text-slate-900 font-mono">{costKg > 0 ? `₦${costKg.toFixed(0)}` : '—'}</span>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-100">
                        <span className="text-slate-500 block text-[10px]">Net Profit</span>
                        <span className={`font-bold font-mono ${fin.netProfitNgn >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                          {formatNgn(fin.netProfitNgn)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setCloseoutTarget(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closeoutSubmitting}
                  className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-60 shadow-xs"
                >
                  {closeoutSubmitting ? 'Closing Out Flock...' : 'Confirm Flock Closeout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW CLOSEOUT SUMMARY MODAL */}
      {viewingCloseoutBatch && viewingCloseoutBatch.closeoutSummary && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] sm:max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-800" />
                  <h2 className="text-lg font-bold text-slate-900">Flock Closeout Summary</h2>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {viewingCloseoutBatch.batchCode} · {viewingCloseoutBatch.birdType} · Closed {viewingCloseoutBatch.closedDate || '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingCloseoutBatch(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Closeout Reason</span>
                  <span className="font-semibold capitalize text-slate-900">{viewingCloseoutBatch.closeoutReason?.replace('_', ' ') || 'Completed'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Final Live Birds</span>
                  <span className="font-semibold font-mono text-slate-900">{viewingCloseoutBatch.finalLiveBirdCount?.toLocaleString() || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Avg Weight</span>
                  <span className="font-semibold font-mono text-slate-900">{viewingCloseoutBatch.averageBirdWeightKg ? `${viewingCloseoutBatch.averageBirdWeightKg} kg` : '—'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <span className="text-slate-500 block text-[10px]">Total Production</span>
                  <span className="font-bold text-slate-900 font-mono text-sm">{formatEggCountInCrates(viewingCloseoutBatch.closeoutSummary.totalIntactEggs)}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">({viewingCloseoutBatch.closeoutSummary.totalIntactEggs.toLocaleString()} pcs)</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <span className="text-slate-500 block text-[10px]">Total Feed Consumed</span>
                  <span className="font-bold text-slate-900 font-mono text-sm">{viewingCloseoutBatch.closeoutSummary.totalFeedKg.toFixed(1)} kg</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">({(viewingCloseoutBatch.closeoutSummary.totalFeedKg / 25).toFixed(1)} bags)</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <span className="text-slate-500 block text-[10px]">Mortality Rate</span>
                  <span className="font-bold text-red-700 font-mono text-sm">{viewingCloseoutBatch.closeoutSummary.mortalityRatePct.toFixed(2)}%</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">{viewingCloseoutBatch.closeoutSummary.totalMortality} birds lost</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <span className="text-slate-500 block text-[10px]">Total Revenue</span>
                  <span className="font-bold text-slate-900 font-mono">{formatNgn(viewingCloseoutBatch.closeoutSummary.totalRevenueNgn)}</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <span className="text-slate-500 block text-[10px]">Total Expenses</span>
                  <span className="font-bold text-slate-900 font-mono">{formatNgn(viewingCloseoutBatch.closeoutSummary.totalExpenseNgn)}</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <span className="text-slate-500 block text-[10px]">Net Profit / Loss</span>
                  <span className={`font-bold font-mono ${viewingCloseoutBatch.closeoutSummary.netProfitNgn >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                    {formatNgn(viewingCloseoutBatch.closeoutSummary.netProfitNgn)}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs space-y-2">
                <p className="font-semibold text-emerald-950 uppercase tracking-wide text-[10px]">Cost Efficiency &amp; Conversion</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className="text-slate-600 block text-[10px]">Cost per Egg</span>
                    <span className="font-bold text-emerald-950 font-mono text-sm">
                      {viewingCloseoutBatch.closeoutSummary.costPerEggNgn > 0 ? `₦${viewingCloseoutBatch.closeoutSummary.costPerEggNgn.toFixed(2)}` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600 block text-[10px]">Cost per kg Live Weight</span>
                    <span className="font-bold text-emerald-950 font-mono text-sm">
                      {viewingCloseoutBatch.closeoutSummary.costPerKgBodyWeightNgn > 0 ? `₦${viewingCloseoutBatch.closeoutSummary.costPerKgBodyWeightNgn.toFixed(0)}` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600 block text-[10px]">Lifetime FCR</span>
                    <span className="font-bold text-emerald-950 font-mono text-sm">
                      {viewingCloseoutBatch.closeoutSummary.lifetimeFcr > 0 ? viewingCloseoutBatch.closeoutSummary.lifetimeFcr.toFixed(2) : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setViewingCloseoutBatch(null)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
