import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Bell,
  Bookmark,
  Calendar,
  Check,
  CheckSquare,
  Edit2,
  Egg,
  FileEdit,
  HeartPulse,
  LayoutGrid,
  Moon,
  Pill,
  Plus,
  Scale,
  Square,
  Sun,
  Sunrise,
  Thermometer,
  Trash2,
  TrendingUp,
  Wheat,
  X,
} from 'lucide-react';
import {
  EGGS_PER_CRATE,
  buildBatchRemindersTimeline,
  buildLast7DaysProductionAndFeedTrends,
  calculateBatchMortalityStats,
  calculateBirdAgeDays,
  computeConsumptionCostNgn,
  convertFeedToGrams,
  findQualifyingPurchaseForConsumption,
  formatBirdAge,
  formatDateInTimezone,
  formatGramsToKgAndBags,
  formatIsoDateDisplay,
  formatNgn,
  hasPermission,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import {
  ADMINISTRATION_ROUTES,
  MEDICATION_TREATMENT_OPTIONS,
  createEnvironmentLog,
  createMedicationLog,
  updateEnvironmentLog,
  updateMedicationLog,
  voidEnvironmentLog,
  voidMedicationLog,
} from '../services/dailyRecordsService.ts';
import { deleteRecordDraft, saveRecordDraft } from '../services/draftsService.ts';
import {
  createFeedConsumption,
  updateFeedConsumptionMeta,
  voidFeedConsumption,
} from '../services/feedService.ts';
import {
  createMortalityEntry,
  updateMortalityEntry,
  voidMortalityEntry,
} from '../services/mortalityService.ts';
import {
  createEggProduction,
  updateEggProduction,
  voidEggProduction,
} from '../services/productionService.ts';
import type {
  DailyProductionDraftPayload,
  EggProductionEntry,
  EnvironmentMetricLog,
  Farm,
  FarmMember,
  FarmReminder,
  FeedConsumption,
  FeedItem,
  FeedPurchase,
  FeedStock,
  FeedUnit,
  MedicationLog,
  MedicationTreatmentType,
  MortalityEntry,
  PoultryBatch,
  RecordDraft,
  TimeOfDay,
} from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';
import { DailyRemindersPanel } from './DailyRemindersPanel.tsx';
import { DailyTrendsCharts } from './DailyTrendsCharts.tsx';
import { MORTALITY_REASON_OPTIONS } from './MortalityView.tsx';

export type DailyProductionSubTab =
  | 'egg'
  | 'feed'
  | 'medication'
  | 'mortality'
  | 'weight'
  | 'environment'
  | 'trends'
  | 'reminders';

type EntryFormLayout = 'grouped' | 'tabbed';

const TIME_OF_DAY_META: Record<
  TimeOfDay,
  { label: string; textClass: string; Icon: React.FC<{ className?: string }> }
> = {
  morning: {
    label: 'Morning',
    textClass: 'text-amber-800',
    Icon: Sunrise,
  },
  afternoon: {
    label: 'Afternoon',
    textClass: 'text-sky-800',
    Icon: Sun,
  },
  night: {
    label: 'Night',
    textClass: 'text-indigo-800',
    Icon: Moon,
  },
};

interface DailyProductionViewProps {
  farm: Farm;
  member: FarmMember;
  batches: PoultryBatch[];
  feedItems: FeedItem[];
  feedStocks: FeedStock[];
  feedPurchases: FeedPurchase[];
  production: EggProductionEntry[];
  consumptions: FeedConsumption[];
  medicationLogs: MedicationLog[];
  mortalityEntries: MortalityEntry[];
  environmentLogs: EnvironmentMetricLog[];
  drafts: RecordDraft[];
  farmReminders?: FarmReminder[];
  initialSubTab?: DailyProductionSubTab;
  initialBatchFilter?: string;
  autoOpenRecordModal?: boolean;
  onConsumedAutoOpen?: () => void;
  onBackToBatches?: () => void;
}

export const DailyProductionView: React.FC<DailyProductionViewProps> = ({
  farm,
  member,
  batches,
  feedItems,
  feedStocks,
  feedPurchases,
  production,
  consumptions,
  medicationLogs,
  mortalityEntries,
  environmentLogs,
  drafts,
  farmReminders = [],
  initialSubTab,
  initialBatchFilter,
  autoOpenRecordModal,
  onConsumedAutoOpen,
  onBackToBatches,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const workbenchRef = useRef<HTMLDivElement | null>(null);

  const canReadProd = hasPermission(member, 'production', 'read');
  const canCreateProd = hasPermission(member, 'production', 'create');
  const canEditProd = hasPermission(member, 'production', 'edit');
  const canDeleteProd = hasPermission(member, 'production', 'delete');

  const canReadFeed = hasPermission(member, 'feed', 'read');
  const canCreateFeed = hasPermission(member, 'feed', 'create');
  const canEditFeed = hasPermission(member, 'feed', 'edit');
  const canDeleteFeed = hasPermission(member, 'feed', 'delete');

  const canReadMortality = hasPermission(member, 'batches', 'read') || canReadProd;
  const canCreateMortality = hasPermission(member, 'batches', 'create') || canCreateProd;
  const canEditMortality = hasPermission(member, 'batches', 'edit') || canEditProd;
  const canDeleteMortality = hasPermission(member, 'batches', 'delete') || canDeleteProd;

  const canCreateAny = canCreateProd || canCreateFeed || canCreateMortality;

  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const activeFeedItems = useMemo(() => feedItems.filter((f) => f.status === 'active'), [feedItems]);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const feedById = useMemo(() => new Map(feedItems.map((f) => [f.id, f])), [feedItems]);
  const stockByItemId = useMemo(
    () => new Map(feedStocks.map((s) => [s.feedItemId, s])),
    [feedStocks]
  );

  const dailyDrafts = useMemo(
    () => drafts.filter((d) => d.draftType === 'daily_production'),
    [drafts]
  );

  // Hub Ledger Tab & Filters
  const [subTab, setSubTab] = useState<DailyProductionSubTab>(initialSubTab || 'egg');
  const [startDate, setStartDate] = useState(`${todayStr.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(todayStr);
  const [batchFilter, setBatchFilter] = useState(initialBatchFilter || 'all');
  const [timeFilter, setTimeFilter] = useState<'all' | TimeOfDay>('all');
  const [showVoided, setShowVoided] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Consolidated Daily Entry Workbench state
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [entryLayout, setEntryLayout] = useState<EntryFormLayout>('grouped');
  const [entryActiveTab, setEntryActiveTab] = useState<DailyProductionSubTab>('egg');
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [collectorSavingDraft, setCollectorSavingDraft] = useState(false);
  const [collectorSubmitting, setCollectorSubmitting] = useState(false);
  const [collectorError, setCollectorError] = useState<string | null>(null);

  // Shared context fields in workbench
  const [txDate, setTxDate] = useState(todayStr);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('morning');
  const [txTime, setTxTime] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');

  // 1. Egg Production
  const [includeEgg, setIncludeEgg] = useState(true);
  const [crates, setCrates] = useState('0');
  const [pieces, setPieces] = useState('0');
  const [crackedEggs, setCrackedEggs] = useState('0');
  const [damagedEggs, setDamagedEggs] = useState('0');
  const [eggRemarks, setEggRemarks] = useState('');

  // 2. Feed Consumption
  const [includeFeed, setIncludeFeed] = useState(false);
  const [feedItemId, setFeedItemId] = useState('');
  const [feedQty, setFeedQty] = useState('');
  const [feedUnit, setFeedUnit] = useState<FeedUnit>('bags');
  const [feedRemarks, setFeedRemarks] = useState('');

  // 3. Medication
  const [includeMedication, setIncludeMedication] = useState(false);
  const [medicationName, setMedicationName] = useState('');
  const [treatmentType, setTreatmentType] = useState<MedicationTreatmentType>('medication');
  const [dosage, setDosage] = useState('');
  const [administrationRoute, setAdministrationRoute] = useState<string>('Drinking Water');
  const [medicationRemarks, setMedicationRemarks] = useState('');

  // 4. Mortality
  const [includeMortality, setIncludeMortality] = useState(false);
  const [mortalityCount, setMortalityCount] = useState('1');
  const [reasonCategory, setReasonCategory] = useState<string>('Disease / Infection');
  const [reasonDetail, setReasonDetail] = useState('');
  const [mortalityRemarks, setMortalityRemarks] = useState('');

  // 5. Weight
  const [includeWeight, setIncludeWeight] = useState(false);
  const [avgWeightGrams, setAvgWeightGrams] = useState('');
  const [sampleSize, setSampleSize] = useState('20');
  const [weightRemarks, setWeightRemarks] = useState('');

  // 6. Environment (Temperature & Humidity)
  const [includeEnvironment, setIncludeEnvironment] = useState(false);
  const [temperatureC, setTemperatureC] = useState('');
  const [humidityPct, setHumidityPct] = useState('');
  const [environmentRemarks, setEnvironmentRemarks] = useState('');

  // Domain Edit Modals
  const [editEgg, setEditEgg] = useState<EggProductionEntry | null>(null);
  const [editFeed, setEditFeed] = useState<FeedConsumption | null>(null);
  const [editMed, setEditMed] = useState<MedicationLog | null>(null);
  const [editMort, setEditMort] = useState<MortalityEntry | null>(null);
  const [editEnv, setEditEnv] = useState<{
    entry: EnvironmentMetricLog;
    mode: 'weight' | 'environment';
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Void Modal
  const [voidTarget, setVoidTarget] = useState<
    | { kind: 'egg'; item: EggProductionEntry }
    | { kind: 'feed'; item: FeedConsumption }
    | { kind: 'medication'; item: MedicationLog }
    | { kind: 'mortality'; item: MortalityEntry }
    | { kind: 'weight'; item: EnvironmentMetricLog }
    | { kind: 'environment'; item: EnvironmentMetricLog }
    | null
  >(null);

  const openCollector = (opts?: {
    focusSection?: DailyProductionSubTab;
    batchId?: string;
    draft?: RecordDraft;
    layout?: EntryFormLayout;
    presetMedication?: {
      treatmentType: MedicationTreatmentType;
      medicationName: string;
      dosage: string;
    };
  }) => {
    setCollectorError(null);

    if (opts?.draft) {
      const p = opts.draft.payload as Partial<DailyProductionDraftPayload>;
      setLoadedDraftId(opts.draft.id);
      setTxDate(p.transactionDate || opts.draft.transactionDate || todayStr);
      setTimeOfDay(p.timeOfDay || 'morning');
      setTxTime(p.transactionTime || '');
      setSelectedBatchId(p.batchId || opts.draft.batchId || activeBatches[0]?.id || '');

      const hasEgg = Boolean(p.includeEgg) && canCreateProd;
      setIncludeEgg(hasEgg);
      setCrates(p.crates ?? '0');
      setPieces(p.pieces ?? '0');
      setCrackedEggs(p.crackedEggs ?? '0');
      setDamagedEggs(p.damagedEggs ?? '0');
      setEggRemarks(p.eggRemarks ?? '');

      const hasFeed = Boolean(p.includeFeed) && canCreateFeed;
      setIncludeFeed(hasFeed);
      setFeedItemId(p.feedItemId || activeFeedItems[0]?.id || '');
      setFeedQty(p.feedQuantity ?? '');
      setFeedUnit(p.feedUnit || 'bags');
      setFeedRemarks(p.feedRemarks ?? '');

      const hasMed = Boolean(p.includeMedication) && canCreateProd;
      setIncludeMedication(hasMed);
      setMedicationName(p.medicationName ?? '');
      setTreatmentType(p.treatmentType || 'medication');
      setDosage(p.dosage ?? '');
      setAdministrationRoute(p.administrationRoute || 'Drinking Water');
      setMedicationRemarks(p.medicationRemarks ?? '');

      const hasMort = Boolean(p.includeMortality) && canCreateMortality;
      setIncludeMortality(hasMort);
      setMortalityCount(p.mortalityCount ?? '1');
      setReasonCategory(p.reasonCategory || 'Disease / Infection');
      setReasonDetail(p.reasonDetail ?? '');
      setMortalityRemarks(p.mortalityRemarks ?? '');

      // Backward compatibility for drafts saved under legacy `includeMetrics`
      const legacyHasWeight = Boolean(p.includeMetrics) && (p.averageWeightGrams ?? '').trim() !== '';
      const legacyHasEnv =
        Boolean(p.includeMetrics) &&
        ((p.temperatureC ?? '').trim() !== '' || (p.humidityPct ?? '').trim() !== '');
      const hasWeight =
        Boolean(p.includeWeight ?? (legacyHasWeight || (p.includeMetrics && !legacyHasEnv))) &&
        canCreateProd;
      const hasEnv = Boolean(p.includeEnvironment ?? legacyHasEnv) && canCreateProd;

      setIncludeWeight(hasWeight);
      setAvgWeightGrams(p.averageWeightGrams ?? '');
      setSampleSize(p.sampleSize ?? '20');
      setWeightRemarks(p.weightRemarks ?? p.metricsRemarks ?? '');

      setIncludeEnvironment(hasEnv);
      setTemperatureC(p.temperatureC ?? '');
      setHumidityPct(p.humidityPct ?? '');
      setEnvironmentRemarks(p.environmentRemarks ?? p.metricsRemarks ?? '');

      const firstEnabled: DailyProductionSubTab = hasEgg
        ? 'egg'
        : hasFeed
        ? 'feed'
        : hasMed
        ? 'medication'
        : hasMort
        ? 'mortality'
        : hasWeight
        ? 'weight'
        : hasEnv
        ? 'environment'
        : 'egg';
      setEntryActiveTab(firstEnabled);
      setEntryLayout(opts.layout || 'grouped');
      setCollectorOpen(true);
      requestAnimationFrame(() => {
        workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      return;
    }

    const rawFocus = opts?.focusSection || subTab;
    const focusAllowed =
      (rawFocus === 'egg' && canCreateProd) ||
      (rawFocus === 'feed' && canCreateFeed) ||
      (rawFocus === 'medication' && canCreateProd) ||
      (rawFocus === 'mortality' && canCreateMortality) ||
      (rawFocus === 'weight' && canCreateProd) ||
      (rawFocus === 'environment' && canCreateProd);
    const focus: DailyProductionSubTab = focusAllowed
      ? rawFocus
      : canCreateProd
      ? 'egg'
      : canCreateFeed
      ? 'feed'
      : 'mortality';
    const preferredBatch =
      (opts?.batchId && activeBatches.find((b) => b.id === opts.batchId)?.id) ||
      (batchFilter !== 'all' && activeBatches.find((b) => b.id === batchFilter)?.id) ||
      activeBatches[0]?.id ||
      '';

    setLoadedDraftId(null);
    setTxDate(todayStr);
    setTimeOfDay('morning');
    setTxTime('');
    setSelectedBatchId(preferredBatch);

    setIncludeEgg(focus === 'egg' && canCreateProd);
    setCrates('0');
    setPieces('0');
    setCrackedEggs('0');
    setDamagedEggs('0');
    setEggRemarks('');

    setIncludeFeed(focus === 'feed' && canCreateFeed);
    setFeedItemId(activeFeedItems[0]?.id || '');
    setFeedQty('');
    setFeedUnit('bags');
    setFeedRemarks('');

    setIncludeMedication(focus === 'medication' && canCreateProd);
    setMedicationName(opts?.presetMedication?.medicationName || '');
    setTreatmentType(opts?.presetMedication?.treatmentType || 'medication');
    setDosage(opts?.presetMedication?.dosage || '');
    setAdministrationRoute('Drinking Water');
    setMedicationRemarks('');

    setIncludeMortality(focus === 'mortality' && canCreateMortality);
    setMortalityCount('1');
    setReasonCategory('Disease / Infection');
    setReasonDetail('');
    setMortalityRemarks('');

    setIncludeWeight(focus === 'weight' && canCreateProd);
    setAvgWeightGrams('');
    setSampleSize('20');
    setWeightRemarks('');

    setIncludeEnvironment(focus === 'environment' && canCreateProd);
    setTemperatureC('');
    setHumidityPct('');
    setEnvironmentRemarks('');

    setEntryActiveTab(focus);
    if (opts?.layout) setEntryLayout(opts.layout);
    setCollectorOpen(true);
    requestAnimationFrame(() => {
      workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  useEffect(() => {
    if (initialSubTab) setSubTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    if (initialBatchFilter) setBatchFilter(initialBatchFilter);
  }, [initialBatchFilter]);

  useEffect(() => {
    if (autoOpenRecordModal) {
      if (canCreateAny && activeBatches.length > 0) {
        openCollector({
          focusSection: initialSubTab || 'mortality',
          batchId: initialBatchFilter,
        });
      }
      onConsumedAutoOpen?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenRecordModal, initialBatchFilter, initialSubTab]);

  // Batch stats for Mortality preview & scorecard
  const batchStatsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateBatchMortalityStats>>();
    for (const b of batches) {
      map.set(b.id, calculateBatchMortalityStats(b, mortalityEntries));
    }
    return map;
  }, [batches, mortalityEntries]);

  // Workbench live previews
  const collectorBatch = batchById.get(selectedBatchId);
  const collectorAgePreview = useMemo(() => {
    if (!collectorBatch || !txDate) return null;
    try {
      const days = calculateBirdAgeDays({
        hatchDate: collectorBatch.hatchDate,
        placementDate: collectorBatch.placementDate,
        ageAtPlacementDays: collectorBatch.ageAtPlacementDays,
        transactionDate: txDate,
      });
      return { ok: true as const, days, text: formatBirdAge(days) };
    } catch (err) {
      return { ok: false as const, text: err instanceof Error ? err.message : String(err) };
    }
  }, [collectorBatch, txDate]);

  const collectorEggPreview = useMemo(() => {
    const c = parseInt(crates || '0', 10) || 0;
    const p = parseInt(pieces || '0', 10) || 0;
    const cr = parseInt(crackedEggs || '0', 10) || 0;
    const dm = parseInt(damagedEggs || '0', 10) || 0;
    const intact = Math.max(0, c) * EGGS_PER_CRATE + Math.max(0, p);
    const total = intact + Math.max(0, cr) + Math.max(0, dm);
    return { intact, total };
  }, [crates, pieces, crackedEggs, damagedEggs]);

  const collectorFeedPreview = useMemo(() => {
    const item = feedById.get(feedItemId);
    const qty = Number(feedQty);
    if (!item || !txDate) return null;
    const stock = stockByItemId.get(item.id);
    const availableGrams = stock?.balanceGrams ?? 0;
    const availFormatted = formatGramsToKgAndBags(availableGrams, item.defaultBagWeightKg);
    const qualifying = findQualifyingPurchaseForConsumption(feedPurchases, item.id, txDate);
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
    const requestedGrams = convertFeedToGrams(qty, feedUnit, item.defaultBagWeightKg);
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
  }, [feedById, feedItemId, feedQty, feedUnit, txDate, stockByItemId, feedPurchases]);

  const collectorMortalityPreview = useMemo(() => {
    if (!collectorBatch) return null;
    const stats = batchStatsMap.get(collectorBatch.id);
    const existingLosses = stats ? stats.totalLosses : 0;
    const available = Math.max(0, collectorBatch.initialCount - existingLosses);
    const countNum = parseInt(mortalityCount || '0', 10);
    const validCount = Number.isInteger(countNum) && countNum >= 1 ? countNum : 0;
    const projectedSurviving = Math.max(0, available - validCount);
    const projectedSurvivalPct =
      collectorBatch.initialCount > 0
        ? Math.round((projectedSurviving / collectorBatch.initialCount) * 10000) / 100
        : 0;
    return {
      available,
      projectedSurviving,
      projectedSurvivalPct,
      exceeds: validCount > available,
    };
  }, [collectorBatch, batchStatsMap, mortalityCount]);

  const selectedSectionCount =
    (includeEgg ? 1 : 0) +
    (includeFeed ? 1 : 0) +
    (includeMedication ? 1 : 0) +
    (includeMortality ? 1 : 0) +
    (includeWeight ? 1 : 0) +
    (includeEnvironment ? 1 : 0);

  const handleSaveDraft = async () => {
    setCollectorError(null);
    setCollectorSavingDraft(true);
    try {
      const batch = batchById.get(selectedBatchId);
      const selectedParts: string[] = [];
      if (includeEgg) selectedParts.push('Eggs');
      if (includeFeed) selectedParts.push('Feed');
      if (includeMedication) selectedParts.push('Med');
      if (includeMortality) selectedParts.push('Mortality');
      if (includeWeight) selectedParts.push('Weight');
      if (includeEnvironment) selectedParts.push('Env');

      const todLabel = TIME_OF_DAY_META[timeOfDay].label;
      const title = `${batch?.batchCode || 'No batch'} · ${formatIsoDateDisplay(txDate)} (${todLabel})${
        selectedParts.length ? ` — ${selectedParts.join(', ')}` : ''
      }`;

      // Keep payload map <= 36 keys (firestore.rules enforces payload.size() <= 40)
      const payload: DailyProductionDraftPayload = {
        transactionDate: txDate,
        timeOfDay,
        transactionTime: txTime,
        batchId: selectedBatchId,
        includeEgg,
        crates,
        pieces,
        crackedEggs,
        damagedEggs,
        eggRemarks,
        includeFeed,
        feedItemId,
        feedQuantity: feedQty,
        feedUnit,
        feedRemarks,
        includeMedication,
        medicationName,
        treatmentType,
        dosage,
        administrationRoute,
        medicationRemarks,
        includeMortality,
        mortalityCount,
        reasonCategory,
        reasonDetail,
        mortalityRemarks,
        includeWeight,
        averageWeightGrams: avgWeightGrams,
        sampleSize,
        weightRemarks,
        includeEnvironment,
        temperatureC,
        humidityPct,
        environmentRemarks,
      };

      const savedId = await saveRecordDraft({
        farmId: farm.farmId,
        existingDraftId: loadedDraftId,
        draftType: 'daily_production',
        title,
        transactionDate: txDate,
        batchId: selectedBatchId,
        payload: payload as unknown as Record<string, unknown>,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setLoadedDraftId(savedId);
      setCollectorOpen(false);
      setFeedback({
        type: 'success',
        text: `Saved draft "${title}". You can resume it anytime from Saved Daily Drafts.`,
      });
    } catch (err) {
      setCollectorError(formatUserFriendlyError(err));
    } finally {
      setCollectorSavingDraft(false);
    }
  };

  const handleSubmitCollector = async (e: React.FormEvent) => {
    e.preventDefault();
    setCollectorError(null);
    setCollectorSubmitting(true);
    try {
      const batch = batchById.get(selectedBatchId);
      if (!batch) throw new Error('Please select an active flock batch.');
      if (batch.status !== 'active') {
        throw new Error(`Batch "${batch.batchCode}" is inactive.`);
      }
      if (
        !includeEgg &&
        !includeFeed &&
        !includeMedication &&
        !includeMortality &&
        !includeWeight &&
        !includeEnvironment
      ) {
        throw new Error('Select at least one daily section to submit (or click Save as Draft).');
      }

      // 1. Pre-validate all checked sections before committing anything
      calculateBirdAgeDays({
        hatchDate: batch.hatchDate,
        placementDate: batch.placementDate,
        ageAtPlacementDays: batch.ageAtPlacementDays,
        transactionDate: txDate,
      });

      const cNum = Number(crates);
      const pNum = Number(pieces);
      const crNum = Number(crackedEggs);
      const dmNum = Number(damagedEggs);
      if (includeEgg) {
        if (!canCreateProd) throw new Error('Missing production create permission.');
        const total = cNum * EGGS_PER_CRATE + pNum + crNum + dmNum;
        if (
          !Number.isInteger(cNum) ||
          !Number.isInteger(pNum) ||
          !Number.isInteger(crNum) ||
          !Number.isInteger(dmNum) ||
          cNum < 0 ||
          pNum < 0 ||
          crNum < 0 ||
          dmNum < 0 ||
          total <= 0
        ) {
          throw new Error('Egg Production: enter valid whole numbers totaling greater than 0 eggs.');
        }
      }

      const selectedFeedItem = feedById.get(feedItemId);
      const feedQtyNum = Number(feedQty);
      if (includeFeed) {
        if (!canCreateFeed) throw new Error('Missing feed create permission.');
        if (!selectedFeedItem) throw new Error('Feed Consumption: select a feed type & brand.');
        if (!Number.isFinite(feedQtyNum) || feedQtyNum <= 0) {
          throw new Error('Feed Consumption: quantity must be greater than zero.');
        }
        if (collectorFeedPreview?.insufficient) {
          throw new Error('Feed Consumption: requested amount exceeds available stock.');
        }
        if (!collectorFeedPreview?.qualifying) {
          throw new Error(
            `Feed Consumption: no purchase recorded on or before ${txDate} for ${selectedFeedItem.feedType}.`
          );
        }
      }

      if (includeMedication) {
        if (!canCreateProd) throw new Error('Missing production create permission for medication.');
        if (!medicationName.trim()) throw new Error('Medication: enter medication or vaccine name.');
        if (!dosage.trim()) throw new Error('Medication: enter dosage.');
        if (!administrationRoute.trim()) throw new Error('Medication: enter administration route.');
      }

      const mortNum = Number(mortalityCount);
      if (includeMortality) {
        if (!canCreateMortality) throw new Error('Missing mortality create permission.');
        if (!Number.isInteger(mortNum) || mortNum < 1) {
          throw new Error('Mortality: birds lost must be a whole number of at least 1.');
        }
        if (reasonCategory === 'Others' && !reasonDetail.trim()) {
          throw new Error('Mortality: specify details when "Others" is selected.');
        }
        if (collectorMortalityPreview?.exceeds) {
          throw new Error(
            `Mortality: cannot exceed ${collectorMortalityPreview.available} surviving birds.`
          );
        }
      }

      const parsedWeight = avgWeightGrams.trim() !== '' ? Number(avgWeightGrams) : null;
      const parsedSample = avgWeightGrams.trim() !== '' ? parseInt(sampleSize || '0', 10) : 0;
      if (includeWeight) {
        if (!canCreateProd) throw new Error('Missing production create permission for weight.');
        if (parsedWeight === null) {
          throw new Error('Weight: enter average bird weight in grams.');
        }
        if (!Number.isFinite(parsedWeight) || parsedWeight <= 0 || parsedWeight > 20000) {
          throw new Error('Weight: average bird weight must be between 1g and 20,000g.');
        }
        if (!Number.isInteger(parsedSample) || parsedSample < 0 || parsedSample > 10000) {
          throw new Error('Weight: sample size must be a whole number between 0 and 10,000.');
        }
      }

      const parsedTemp = temperatureC.trim() !== '' ? Number(temperatureC) : null;
      const parsedHumidity = humidityPct.trim() !== '' ? Number(humidityPct) : null;
      if (includeEnvironment) {
        if (!canCreateProd) throw new Error('Missing production create permission for environment.');
        if (parsedTemp === null && parsedHumidity === null) {
          throw new Error('Environment: enter Temperature (°C), Humidity (%), or both.');
        }
        if (parsedTemp !== null && (!Number.isFinite(parsedTemp) || parsedTemp < -10 || parsedTemp > 70)) {
          throw new Error('Environment: temperature must be between -10°C and 70°C.');
        }
        if (
          parsedHumidity !== null &&
          (!Number.isFinite(parsedHumidity) || parsedHumidity < 0 || parsedHumidity > 100)
        ) {
          throw new Error('Environment: humidity must be between 0% and 100%.');
        }
      }

      // 2. Commit selected sections atomically per domain
      const savedLabels: string[] = [];
      const todDefaultClock =
        txTime ||
        (timeOfDay === 'morning' ? '08:00' : timeOfDay === 'afternoon' ? '14:00' : '20:00');

      if (includeEgg) {
        await createEggProduction({
          farmId: farm.farmId,
          transactionDate: txDate,
          transactionTime: todDefaultClock,
          batch,
          crates: cNum,
          pieces: pNum,
          crackedEggs: crNum,
          damagedEggs: dmNum,
          remarks: eggRemarks
            ? `[${TIME_OF_DAY_META[timeOfDay].label}] ${eggRemarks}`
            : `${TIME_OF_DAY_META[timeOfDay].label} collection`,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        savedLabels.push(`${collectorEggPreview.total} eggs`);
        setIncludeEgg(false);
      }

      if (includeFeed && selectedFeedItem) {
        await createFeedConsumption({
          farmId: farm.farmId,
          transactionDate: txDate,
          transactionTime: todDefaultClock,
          batch,
          feedItem: selectedFeedItem,
          enteredQuantity: feedQtyNum,
          enteredUnit: feedUnit,
          remarks: feedRemarks
            ? `[${TIME_OF_DAY_META[timeOfDay].label}] ${feedRemarks}`
            : `${TIME_OF_DAY_META[timeOfDay].label} feeding`,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        savedLabels.push(`${feedQtyNum} ${feedUnit} feed`);
        setIncludeFeed(false);
      }

      if (includeMedication) {
        await createMedicationLog({
          farmId: farm.farmId,
          transactionDate: txDate,
          timeOfDay,
          transactionTime: txTime,
          batch,
          medicationName,
          treatmentType,
          dosage,
          administrationRoute,
          remarks: medicationRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        savedLabels.push(`Med: ${medicationName.trim()}`);
        setIncludeMedication(false);
      }

      if (includeMortality) {
        await createMortalityEntry({
          farmId: farm.farmId,
          transactionDate: txDate,
          timeOfDay,
          batch,
          mortalityCount: mortNum,
          reasonCategory,
          reasonDetail,
          remarks: mortalityRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        savedLabels.push(`${mortNum} mortality`);
        setIncludeMortality(false);
      }

      if (includeWeight && parsedWeight !== null) {
        await createEnvironmentLog({
          farmId: farm.farmId,
          transactionDate: txDate,
          timeOfDay,
          transactionTime: txTime,
          batch,
          averageWeightGrams: parsedWeight,
          sampleSize: parsedSample,
          temperatureC: null,
          humidityPct: null,
          remarks: weightRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        savedLabels.push(`${parsedWeight}g avg weight`);
        setIncludeWeight(false);
      }

      if (includeEnvironment && (parsedTemp !== null || parsedHumidity !== null)) {
        await createEnvironmentLog({
          farmId: farm.farmId,
          transactionDate: txDate,
          timeOfDay,
          transactionTime: txTime,
          batch,
          averageWeightGrams: null,
          sampleSize: 0,
          temperatureC: parsedTemp,
          humidityPct: parsedHumidity,
          remarks: environmentRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        const envParts: string[] = [];
        if (parsedTemp !== null) envParts.push(`${parsedTemp}°C`);
        if (parsedHumidity !== null) envParts.push(`${parsedHumidity}% RH`);
        savedLabels.push(`Env (${envParts.join(', ')})`);
        setIncludeEnvironment(false);
      }

      if (loadedDraftId) {
        await deleteRecordDraft({ farmId: farm.farmId, draftId: loadedDraftId });
        setLoadedDraftId(null);
      }

      setCollectorOpen(false);
      setFeedback({
        type: 'success',
        text: `Recorded for ${batch.batchCode} (${formatIsoDateDisplay(txDate)}, ${TIME_OF_DAY_META[timeOfDay].label}): ${savedLabels.join(' · ')}.`,
      });
    } catch (err) {
      setCollectorError(formatUserFriendlyError(err));
    } finally {
      setCollectorSubmitting(false);
    }
  };

  // Filtered Ledgers for Each of the 6 Domains
  const filteredProd = useMemo(
    () =>
      production.filter(
        (e) =>
          (showVoided || !e.isVoided) &&
          (!startDate || e.transactionDate >= startDate) &&
          (!endDate || e.transactionDate <= endDate) &&
          (batchFilter === 'all' || e.batchId === batchFilter)
      ),
    [production, showVoided, startDate, endDate, batchFilter]
  );

  const filteredCons = useMemo(
    () =>
      consumptions.filter(
        (c) =>
          (showVoided || !c.isVoided) &&
          (!startDate || c.transactionDate >= startDate) &&
          (!endDate || c.transactionDate <= endDate) &&
          (batchFilter === 'all' || c.batchId === batchFilter)
      ),
    [consumptions, showVoided, startDate, endDate, batchFilter]
  );

  const filteredMeds = useMemo(
    () =>
      medicationLogs.filter(
        (m) =>
          (showVoided || !m.isVoided) &&
          (!startDate || m.transactionDate >= startDate) &&
          (!endDate || m.transactionDate <= endDate) &&
          (batchFilter === 'all' || m.batchId === batchFilter) &&
          (timeFilter === 'all' || m.timeOfDay === timeFilter)
      ),
    [medicationLogs, showVoided, startDate, endDate, batchFilter, timeFilter]
  );

  const filteredMortality = useMemo(
    () =>
      mortalityEntries.filter(
        (m) =>
          (showVoided || !m.isVoided) &&
          (!startDate || m.transactionDate >= startDate) &&
          (!endDate || m.transactionDate <= endDate) &&
          (batchFilter === 'all' || m.batchId === batchFilter) &&
          (timeFilter === 'all' || m.timeOfDay === timeFilter)
      ),
    [mortalityEntries, showVoided, startDate, endDate, batchFilter, timeFilter]
  );

  const filteredWeight = useMemo(
    () =>
      environmentLogs.filter(
        (e) =>
          e.averageWeightGrams !== null &&
          (showVoided || !e.isVoided) &&
          (!startDate || e.transactionDate >= startDate) &&
          (!endDate || e.transactionDate <= endDate) &&
          (batchFilter === 'all' || e.batchId === batchFilter) &&
          (timeFilter === 'all' || e.timeOfDay === timeFilter)
      ),
    [environmentLogs, showVoided, startDate, endDate, batchFilter, timeFilter]
  );

  const filteredEnv = useMemo(
    () =>
      environmentLogs.filter(
        (e) =>
          (e.temperatureC !== null || e.humidityPct !== null) &&
          (showVoided || !e.isVoided) &&
          (!startDate || e.transactionDate >= startDate) &&
          (!endDate || e.transactionDate <= endDate) &&
          (batchFilter === 'all' || e.batchId === batchFilter) &&
          (timeFilter === 'all' || e.timeOfDay === timeFilter)
      ),
    [environmentLogs, showVoided, startDate, endDate, batchFilter, timeFilter]
  );

  // Aggregates for KPI strips
  const eggSummary = useMemo(
    () =>
      filteredProd
        .filter((e) => !e.isVoided)
        .reduce(
          (acc, e) => {
            acc.entries += 1;
            acc.intactEggs += e.intactEggs;
            acc.crackedEggs += e.crackedEggs;
            acc.damagedEggs += e.damagedEggs;
            acc.totalEggs += e.totalEggs;
            return acc;
          },
          { entries: 0, intactEggs: 0, crackedEggs: 0, damagedEggs: 0, totalEggs: 0 }
        ),
    [filteredProd]
  );

  const feedSummary = useMemo(
    () =>
      filteredCons
        .filter((c) => !c.isVoided)
        .reduce(
          (acc, c) => {
            acc.entries += 1;
            acc.grams += c.standardizedGrams;
            acc.costNgn += c.totalCostNgn;
            return acc;
          },
          { entries: 0, grams: 0, costNgn: 0 }
        ),
    [filteredCons]
  );

  const weightSummary = useMemo(() => {
    const active = filteredWeight.filter((e) => !e.isVoided && e.averageWeightGrams !== null);
    const weights = active.map((e) => e.averageWeightGrams as number);
    const totalSamples = active.reduce((s, e) => s + (e.sampleSize || 0), 0);
    const avgWeightG = weights.length
      ? Math.round((weights.reduce((s, n) => s + n, 0) / weights.length) * 10) / 10
      : null;
    const latestWeightG = active.length > 0 ? active[0].averageWeightGrams : null;
    return {
      entries: active.length,
      avgWeightG,
      latestWeightG,
      totalSamples,
    };
  }, [filteredWeight]);

  const envSummary = useMemo(() => {
    const active = filteredEnv.filter((e) => !e.isVoided);
    const temps = active.map((e) => e.temperatureC).filter((v): v is number => v !== null);
    const hums = active.map((e) => e.humidityPct).filter((v): v is number => v !== null);
    const avg = (arr: number[]) =>
      arr.length ? Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 10) / 10 : null;
    return {
      entries: active.length,
      avgTempC: avg(temps),
      minTempC: temps.length ? Math.min(...temps) : null,
      maxTempC: temps.length ? Math.max(...temps) : null,
      avgHumidityPct: avg(hums),
      minHumidityPct: hums.length ? Math.min(...hums) : null,
      maxHumidityPct: hums.length ? Math.max(...hums) : null,
    };
  }, [filteredEnv]);

  const activeFlockHealth = useMemo(() => {
    let initial = 0;
    let losses = 0;
    for (const b of activeBatches) {
      const st = batchStatsMap.get(b.id);
      if (!st) continue;
      initial += st.initialCount;
      losses += st.totalLosses;
    }
    const surviving = Math.max(0, initial - losses);
    const survivalPct = initial > 0 ? Math.round((surviving / initial) * 10000) / 100 : 0;
    return { initial, losses, surviving, survivalPct };
  }, [activeBatches, batchStatsMap]);

  const last7DaysTrends = useMemo(
    () =>
      buildLast7DaysProductionAndFeedTrends({
        todayDateStr: todayStr,
        production,
        consumptions,
        batchId: batchFilter,
      }),
    [todayStr, production, consumptions, batchFilter]
  );

  const scopedBatchLabel = useMemo(() => {
    if (batchFilter === 'all') return 'All Batches';
    const b = batchById.get(batchFilter);
    return b ? `${b.batchCode} (${b.penNameSnapshot})` : 'Selected Batch';
  }, [batchFilter, batchById]);

  const remindersTimeline = useMemo(
    () =>
      buildBatchRemindersTimeline({
        todayDateStr: todayStr,
        batches,
        reminders: farmReminders,
        batchId: batchFilter,
      }),
    [todayStr, batches, farmReminders, batchFilter]
  );

  const urgentRemindersCount = useMemo(
    () =>
      remindersTimeline.filter((r) => r.status === 'pending' && r.daysUntilDue <= 14).length,
    [remindersTimeline]
  );

  const subTabs: {
    id: DailyProductionSubTab;
    label: string;
    shortLabel: string;
    count: number;
    countLabel?: string;
    Icon: React.FC<{ className?: string }>;
    visible: boolean;
    canCreate: boolean;
    checkedInForm: boolean;
  }[] = [
    {
      id: 'egg',
      label: 'Egg Production',
      shortLabel: 'Eggs',
      count: filteredProd.filter((x) => !x.isVoided).length,
      Icon: Egg,
      visible: canReadProd,
      canCreate: canCreateProd,
      checkedInForm: includeEgg,
    },
    {
      id: 'feed',
      label: 'Feed Consumption',
      shortLabel: 'Feed',
      count: filteredCons.filter((x) => !x.isVoided).length,
      Icon: Wheat,
      visible: canReadFeed,
      canCreate: canCreateFeed,
      checkedInForm: includeFeed,
    },
    {
      id: 'medication',
      label: 'Medication',
      shortLabel: 'Medication',
      count: filteredMeds.filter((x) => !x.isVoided).length,
      Icon: Pill,
      visible: canReadProd || canReadMortality,
      canCreate: canCreateProd,
      checkedInForm: includeMedication,
    },
    {
      id: 'mortality',
      label: 'Mortality',
      shortLabel: 'Mortality',
      count: filteredMortality.filter((x) => !x.isVoided).length,
      Icon: HeartPulse,
      visible: canReadMortality,
      canCreate: canCreateMortality,
      checkedInForm: includeMortality,
    },
    {
      id: 'weight',
      label: 'Weight',
      shortLabel: 'Weight',
      count: filteredWeight.filter((x) => !x.isVoided).length,
      Icon: Scale,
      visible: canReadProd || canReadMortality,
      canCreate: canCreateProd,
      checkedInForm: includeWeight,
    },
    {
      id: 'environment',
      label: 'Environment (Temp/Humidity)',
      shortLabel: 'Environment',
      count: filteredEnv.filter((x) => !x.isVoided).length,
      Icon: Thermometer,
      visible: canReadProd || canReadMortality,
      canCreate: canCreateProd,
      checkedInForm: includeEnvironment,
    },
    {
      id: 'trends',
      label: 'Trends',
      shortLabel: 'Trends',
      count: 7,
      countLabel: '7d',
      Icon: TrendingUp,
      visible: canReadProd || canReadFeed,
      canCreate: false,
      checkedInForm: false,
    },
    {
      id: 'reminders',
      label: 'Reminders',
      shortLabel: 'Reminders',
      count: urgentRemindersCount,
      countLabel:
        urgentRemindersCount > 0
          ? `${urgentRemindersCount} due`
          : String(remindersTimeline.filter((r) => r.status === 'pending').length),
      Icon: Bell,
      visible: canReadProd || canReadMortality,
      canCreate: false,
      checkedInForm: false,
    },
  ];

  const visibleSubTabs = subTabs.filter((t) => t.visible);
  const effectiveSubTab =
    visibleSubTabs.find((t) => t.id === subTab)?.id || visibleSubTabs[0]?.id || subTab;
  const creatableSubTabs = subTabs.filter((t) => t.canCreate);
  const effectiveEntryTab =
    creatableSubTabs.find((t) => t.id === entryActiveTab)?.id ||
    creatableSubTabs[0]?.id ||
    entryActiveTab;

  // Edit Form State helpers
  const [eDate, setEDate] = useState('');
  const [eTime, setETime] = useState('');
  const [eTod, setETod] = useState<TimeOfDay>('morning');
  const [eBatchId, setEBatchId] = useState('');
  const [eRemarks, setERemarks] = useState('');
  // Egg edit
  const [eCrates, setECrates] = useState('0');
  const [ePieces, setEPieces] = useState('0');
  const [eCracked, setECracked] = useState('0');
  const [eDamaged, setEDamaged] = useState('0');
  // Med edit
  const [eMedName, setEMedName] = useState('');
  const [eMedType, setEMedType] = useState<MedicationTreatmentType>('medication');
  const [eDosage, setEDosage] = useState('');
  const [eRoute, setERoute] = useState('');
  // Mortality edit
  const [eMortCount, setEMortCount] = useState('1');
  const [eMortReason, setEMortReason] = useState('Disease / Infection');
  const [eMortDetail, setEMortDetail] = useState('');
  // Weight & Environment edit
  const [eWeight, setEWeight] = useState('');
  const [eSample, setESample] = useState('20');
  const [eTemp, setETemp] = useState('');
  const [eHum, setEHum] = useState('');

  const startEditEgg = (entry: EggProductionEntry) => {
    setEditError(null);
    setEditEgg(entry);
    setEDate(entry.transactionDate);
    setETime(entry.transactionTime);
    setEBatchId(entry.batchId);
    setECrates(String(entry.crates));
    setEPieces(String(entry.pieces));
    setECracked(String(entry.crackedEggs));
    setEDamaged(String(entry.damagedEggs));
    setERemarks(entry.remarks);
  };

  const startEditFeed = (c: FeedConsumption) => {
    setEditError(null);
    setEditFeed(c);
    setEDate(c.transactionDate);
    setETime(c.transactionTime);
    setERemarks(c.remarks);
  };

  const startEditMed = (m: MedicationLog) => {
    setEditError(null);
    setEditMed(m);
    setEDate(m.transactionDate);
    setETime(m.transactionTime);
    setETod(m.timeOfDay);
    setEBatchId(m.batchId);
    setEMedName(m.medicationName);
    setEMedType(m.treatmentType);
    setEDosage(m.dosage);
    setERoute(m.administrationRoute);
    setERemarks(m.remarks);
  };

  const startEditMort = (m: MortalityEntry) => {
    setEditError(null);
    setEditMort(m);
    setEDate(m.transactionDate);
    setETod(m.timeOfDay);
    setEBatchId(m.batchId);
    setEMortCount(String(m.mortalityCount));
    const isStd = (MORTALITY_REASON_OPTIONS as readonly string[]).includes(m.reasonCategory);
    setEMortReason(isStd ? m.reasonCategory : 'Others');
    setEMortDetail(
      isStd ? m.reasonDetail : `${m.reasonCategory}${m.reasonDetail ? ` — ${m.reasonDetail}` : ''}`
    );
    setERemarks(m.remarks);
  };

  const startEditEnv = (env: EnvironmentMetricLog, mode: 'weight' | 'environment') => {
    setEditError(null);
    setEditEnv({ entry: env, mode });
    setEDate(env.transactionDate);
    setETime(env.transactionTime);
    setETod(env.timeOfDay);
    setEBatchId(env.batchId);
    setEWeight(env.averageWeightGrams !== null ? String(env.averageWeightGrams) : '');
    setESample(String(env.sampleSize || 0));
    setETemp(env.temperatureC !== null ? String(env.temperatureC) : '');
    setEHum(env.humidityPct !== null ? String(env.humidityPct) : '');
    setERemarks(env.remarks);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    setEditSaving(true);
    try {
      if (editEgg) {
        const batch = batchById.get(eBatchId);
        if (!batch) throw new Error('Select a valid batch.');
        await updateEggProduction({
          farmId: farm.farmId,
          entry: editEgg,
          batch,
          transactionDate: eDate,
          transactionTime: eTime,
          crates: Number(eCrates),
          pieces: Number(ePieces),
          crackedEggs: Number(eCracked),
          damagedEggs: Number(eDamaged),
          remarks: eRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setEditEgg(null);
        setFeedback({ type: 'success', text: 'Egg production entry updated.' });
      } else if (editFeed) {
        await updateFeedConsumptionMeta({
          farmId: farm.farmId,
          consumption: editFeed,
          transactionDate: eDate,
          transactionTime: eTime,
          remarks: eRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setEditFeed(null);
        setFeedback({
          type: 'success',
          text: 'Feed consumption notes/date updated (cost snapshot unchanged).',
        });
      } else if (editMed) {
        const batch = batchById.get(eBatchId);
        if (!batch) throw new Error('Select a valid batch.');
        await updateMedicationLog({
          farmId: farm.farmId,
          entry: editMed,
          batch,
          transactionDate: eDate,
          timeOfDay: eTod,
          transactionTime: eTime,
          medicationName: eMedName,
          treatmentType: eMedType,
          dosage: eDosage,
          administrationRoute: eRoute,
          remarks: eRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setEditMed(null);
        setFeedback({ type: 'success', text: 'Medication log updated.' });
      } else if (editMort) {
        const batch = batchById.get(eBatchId);
        if (!batch) throw new Error('Select a valid batch.');
        await updateMortalityEntry({
          farmId: farm.farmId,
          entry: editMort,
          batch,
          transactionDate: eDate,
          timeOfDay: eTod,
          mortalityCount: Number(eMortCount),
          reasonCategory: eMortReason,
          reasonDetail: eMortDetail,
          remarks: eRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setEditMort(null);
        setFeedback({ type: 'success', text: 'Mortality entry updated.' });
      } else if (editEnv) {
        const batch = batchById.get(eBatchId);
        if (!batch) throw new Error('Select a valid batch.');
        const nextWeight =
          editEnv.mode === 'weight'
            ? eWeight.trim() !== ''
              ? Number(eWeight)
              : null
            : editEnv.entry.averageWeightGrams;
        const nextSample =
          editEnv.mode === 'weight'
            ? eWeight.trim() !== ''
              ? parseInt(eSample || '0', 10)
              : 0
            : editEnv.entry.sampleSize;
        const nextTemp =
          editEnv.mode === 'environment'
            ? eTemp.trim() !== ''
              ? Number(eTemp)
              : null
            : editEnv.entry.temperatureC;
        const nextHum =
          editEnv.mode === 'environment'
            ? eHum.trim() !== ''
              ? Number(eHum)
              : null
            : editEnv.entry.humidityPct;

        await updateEnvironmentLog({
          farmId: farm.farmId,
          entry: editEnv.entry,
          batch,
          transactionDate: eDate,
          timeOfDay: eTod,
          transactionTime: eTime,
          averageWeightGrams: nextWeight,
          sampleSize: nextSample,
          temperatureC: nextTemp,
          humidityPct: nextHum,
          remarks: eRemarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        const label = editEnv.mode === 'weight' ? 'Weight' : 'Environment';
        setEditEnv(null);
        setFeedback({ type: 'success', text: `${label} reading updated.` });
      }
    } catch (err) {
      setEditError(formatUserFriendlyError(err));
    } finally {
      setEditSaving(false);
    }
  };

  // Reusable Section Renderers inside the Consolidated Entry Workbench
  const renderEggSectionCard = (alwaysExpanded: boolean) => {
    if (!canCreateProd) return null;
    const expanded = alwaysExpanded || includeEgg;
    return (
      <div
        className={`rounded-xl border transition-colors ${
          includeEgg ? 'border-emerald-700 bg-white' : 'border-slate-200 bg-slate-50/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setIncludeEgg((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {includeEgg ? (
              <CheckSquare className="h-4 w-4 shrink-0 text-emerald-800" />
            ) : (
              <Square className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <Egg className="h-4 w-4 shrink-0 text-emerald-800" />
            <span className="text-sm font-semibold text-slate-900">1. Egg Production</span>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums whitespace-nowrap shrink-0">
            {includeEgg ? `${collectorEggPreview.total.toLocaleString()} eggs` : 'Click to include'}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            {!includeEgg && (
              <p className="text-[11px] text-amber-800">
                Toggle the checkbox above or edit values below to include Egg Production in this submission.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Crates (×30)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={crates}
                  onChange={(e) => {
                    setCrates(e.target.value);
                    if (!includeEgg) setIncludeEgg(true);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Extra Pieces</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={pieces}
                  onChange={(e) => {
                    setPieces(e.target.value);
                    if (!includeEgg) setIncludeEgg(true);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Cracked</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={crackedEggs}
                  onChange={(e) => {
                    setCrackedEggs(e.target.value);
                    if (!includeEgg) setIncludeEgg(true);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Damaged</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={damagedEggs}
                  onChange={(e) => {
                    setDamagedEggs(e.target.value);
                    if (!includeEgg) setIncludeEgg(true);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs tabular-nums">
              <span>
                Intact:{' '}
                <strong className="font-mono text-emerald-800">
                  {collectorEggPreview.intact.toLocaleString()}
                </strong>
              </span>
              <span>
                Total Collected:{' '}
                <strong className="font-mono text-slate-900">
                  {collectorEggPreview.total.toLocaleString()}
                </strong>
              </span>
            </div>
            <input
              type="text"
              maxLength={500}
              value={eggRemarks}
              onChange={(e) => {
                setEggRemarks(e.target.value);
                if (!includeEgg && e.target.value) setIncludeEgg(true);
              }}
              placeholder="Egg collection remarks (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        )}
      </div>
    );
  };

  const renderFeedSectionCard = (alwaysExpanded: boolean) => {
    if (!canCreateFeed) return null;
    const expanded = alwaysExpanded || includeFeed;
    return (
      <div
        className={`rounded-xl border transition-colors ${
          includeFeed ? 'border-emerald-700 bg-white' : 'border-slate-200 bg-slate-50/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setIncludeFeed((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {includeFeed ? (
              <CheckSquare className="h-4 w-4 shrink-0 text-emerald-800" />
            ) : (
              <Square className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <Wheat className="h-4 w-4 shrink-0 text-emerald-800" />
            <span className="text-sm font-semibold text-slate-900">
              2. Feed Consumption
            </span>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums whitespace-nowrap shrink-0">
            {includeFeed && collectorFeedPreview?.estimatedCostNgn
              ? formatNgn(collectorFeedPreview.estimatedCostNgn)
              : 'Click to include'}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Feed Type &amp; Brand</label>
                <select
                  value={feedItemId}
                  onChange={(e) => {
                    setFeedItemId(e.target.value);
                    if (!includeFeed && e.target.value) setIncludeFeed(true);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  <option value="">Select feed...</option>
                  {activeFeedItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.feedType} — {i.brand}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Quantity</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={feedQty}
                  onChange={(e) => {
                    setFeedQty(e.target.value);
                    if (!includeFeed && e.target.value) setIncludeFeed(true);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Unit</label>
                <select
                  value={feedUnit}
                  onChange={(e) => setFeedUnit(e.target.value as FeedUnit)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  <option value="bags">Bags</option>
                  <option value="kg">Kilograms (kg)</option>
                </select>
              </div>
            </div>

            {collectorFeedPreview && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs tabular-nums ${
                  collectorFeedPreview.insufficient || !collectorFeedPreview.qualifying
                    ? 'border-red-200 bg-red-50 text-red-900'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    Available Stock:{' '}
                    <strong className="font-mono">
                      {collectorFeedPreview.availFormatted.kgText} ({collectorFeedPreview.availFormatted.bagsText})
                    </strong>
                  </span>
                  {collectorFeedPreview.qualifying ? (
                    <span>
                      Locked Cost Est.:{' '}
                      <strong className="font-mono text-slate-900">
                        {formatNgn(collectorFeedPreview.estimatedCostNgn)}
                      </strong>{' '}
                      (src {collectorFeedPreview.qualifying.purchaseDate})
                    </span>
                  ) : (
                    <span className="font-semibold text-red-700">No purchase &le; {txDate}</span>
                  )}
                </div>
              </div>
            )}
            <input
              type="text"
              maxLength={500}
              value={feedRemarks}
              onChange={(e) => setFeedRemarks(e.target.value)}
              placeholder="Feeding remarks (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        )}
      </div>
    );
  };

  const renderMedicationSectionCard = (alwaysExpanded: boolean) => {
    if (!canCreateProd) return null;
    const expanded = alwaysExpanded || includeMedication;
    return (
      <div
        className={`rounded-xl border transition-colors ${
          includeMedication ? 'border-emerald-700 bg-white' : 'border-slate-200 bg-slate-50/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setIncludeMedication((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {includeMedication ? (
              <CheckSquare className="h-4 w-4 shrink-0 text-emerald-800" />
            ) : (
              <Square className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <Pill className="h-4 w-4 shrink-0 text-emerald-800" />
            <span className="text-sm font-semibold text-slate-900">3. Medication</span>
          </div>
          <span className="text-xs text-slate-600 truncate max-w-[140px]">
            {includeMedication && medicationName ? medicationName : 'Click to include'}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Treatment Type</label>
                <select
                  value={treatmentType}
                  onChange={(e) => setTreatmentType(e.target.value as MedicationTreatmentType)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  {MEDICATION_TREATMENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Medication / Vaccine Name</label>
                <input
                  type="text"
                  maxLength={120}
                  value={medicationName}
                  onChange={(e) => {
                    setMedicationName(e.target.value);
                    if (!includeMedication && e.target.value) setIncludeMedication(true);
                  }}
                  placeholder="e.g. Lasota Vaccine, Oxytetracycline"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Dosage</label>
                <input
                  type="text"
                  maxLength={80}
                  value={dosage}
                  onChange={(e) => {
                    setDosage(e.target.value);
                    if (!includeMedication && e.target.value) setIncludeMedication(true);
                  }}
                  placeholder="e.g. 100ml / 200L water"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Administration Route</label>
                <select
                  value={administrationRoute}
                  onChange={(e) => setAdministrationRoute(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  {ADMINISTRATION_ROUTES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <input
              type="text"
              maxLength={500}
              value={medicationRemarks}
              onChange={(e) => setMedicationRemarks(e.target.value)}
              placeholder="Treatment notes / withdrawal period (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        )}
      </div>
    );
  };

  const renderMortalitySectionCard = (alwaysExpanded: boolean) => {
    if (!canCreateMortality) return null;
    const expanded = alwaysExpanded || includeMortality;
    return (
      <div
        className={`rounded-xl border transition-colors ${
          includeMortality ? 'border-emerald-700 bg-white' : 'border-slate-200 bg-slate-50/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setIncludeMortality((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {includeMortality ? (
              <CheckSquare className="h-4 w-4 shrink-0 text-emerald-800" />
            ) : (
              <Square className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <HeartPulse className="h-4 w-4 shrink-0 text-red-700" />
            <span className="text-sm font-semibold text-slate-900">4. Mortality</span>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums whitespace-nowrap shrink-0">
            {includeMortality ? `${mortalityCount} bird(s)` : 'Click to include'}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Birds Lost</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={mortalityCount}
                  onChange={(e) => {
                    setMortalityCount(e.target.value);
                    if (!includeMortality) setIncludeMortality(true);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Reason for Death</label>
                <select
                  value={reasonCategory}
                  onChange={(e) => setReasonCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  {MORTALITY_REASON_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {collectorMortalityPreview && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs tabular-nums ${
                  collectorMortalityPreview.exceeds
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                {collectorMortalityPreview.exceeds ? (
                  <span>
                    Exceeds remaining surviving birds ({collectorMortalityPreview.available}).
                  </span>
                ) : (
                  <span>
                    Projected Surviving:{' '}
                    <strong className="font-mono text-slate-900">
                      {collectorMortalityPreview.projectedSurviving.toLocaleString()}
                    </strong>{' '}
                    ({collectorMortalityPreview.projectedSurvivalPct.toFixed(2)}% survival)
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                maxLength={300}
                value={reasonDetail}
                onChange={(e) => setReasonDetail(e.target.value)}
                placeholder={
                  reasonCategory === 'Others'
                    ? 'Specify reason for death (required)...'
                    : 'Clinical signs / details (optional)'
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
              <input
                type="text"
                maxLength={500}
                value={mortalityRemarks}
                onChange={(e) => setMortalityRemarks(e.target.value)}
                placeholder="Disposal / inspection remarks (optional)"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderWeightSectionCard = (alwaysExpanded: boolean) => {
    if (!canCreateProd) return null;
    const expanded = alwaysExpanded || includeWeight;
    const parsedW = avgWeightGrams.trim() !== '' ? Number(avgWeightGrams) : NaN;
    return (
      <div
        className={`rounded-xl border transition-colors ${
          includeWeight ? 'border-emerald-700 bg-white' : 'border-slate-200 bg-slate-50/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setIncludeWeight((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {includeWeight ? (
              <CheckSquare className="h-4 w-4 shrink-0 text-emerald-800" />
            ) : (
              <Square className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <Scale className="h-4 w-4 shrink-0 text-emerald-800" />
            <span className="text-sm font-semibold text-slate-900">5. Bird Weight</span>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums whitespace-nowrap shrink-0">
            {includeWeight && Number.isFinite(parsedW) && parsedW > 0
              ? `${parsedW.toLocaleString()} g`
              : 'Click to include'}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Average Bird Weight (g)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="20000"
                  value={avgWeightGrams}
                  onChange={(e) => {
                    setAvgWeightGrams(e.target.value);
                    if (!includeWeight && e.target.value) setIncludeWeight(true);
                  }}
                  placeholder="e.g. 1650"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Sample Size (birds weighed)
                </label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  value={sampleSize}
                  onChange={(e) => setSampleSize(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
            </div>
            {Number.isFinite(parsedW) && parsedW > 0 && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 tabular-nums">
                Equivalent:{' '}
                <strong className="font-mono text-emerald-800">
                  {(parsedW / 1000).toFixed(2)} kg / bird
                </strong>
                {Number(sampleSize) > 0 && (
                  <span className="ml-2 text-slate-500">
                    (Sample of {Number(sampleSize)} birds)
                  </span>
                )}
              </div>
            )}
            <input
              type="text"
              maxLength={500}
              value={weightRemarks}
              onChange={(e) => setWeightRemarks(e.target.value)}
              placeholder="Uniformity / flock condition notes (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        )}
      </div>
    );
  };

  const renderEnvironmentSectionCard = (alwaysExpanded: boolean) => {
    if (!canCreateProd) return null;
    const expanded = alwaysExpanded || includeEnvironment;
    const summaryParts: string[] = [];
    if (temperatureC.trim()) summaryParts.push(`${temperatureC}°C`);
    if (humidityPct.trim()) summaryParts.push(`${humidityPct}% RH`);

    return (
      <div
        className={`rounded-xl border transition-colors ${
          includeEnvironment ? 'border-emerald-700 bg-white' : 'border-slate-200 bg-slate-50/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setIncludeEnvironment((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {includeEnvironment ? (
              <CheckSquare className="h-4 w-4 shrink-0 text-emerald-800" />
            ) : (
              <Square className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <Thermometer className="h-4 w-4 shrink-0 text-sky-700" />
            <span className="text-sm font-semibold text-slate-900">
              6. Environment (Temp / Humidity)
            </span>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums whitespace-nowrap shrink-0">
            {includeEnvironment && summaryParts.length > 0
              ? summaryParts.join(' · ')
              : 'Click to include'}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Pen Temperature (°C)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="-10"
                  max="70"
                  value={temperatureC}
                  onChange={(e) => {
                    setTemperatureC(e.target.value);
                    if (!includeEnvironment && e.target.value) setIncludeEnvironment(true);
                  }}
                  placeholder="e.g. 28.5"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Relative Humidity (% RH)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={humidityPct}
                  onChange={(e) => {
                    setHumidityPct(e.target.value);
                    if (!includeEnvironment && e.target.value) setIncludeEnvironment(true);
                  }}
                  placeholder="e.g. 68"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                />
              </div>
            </div>
            <input
              type="text"
              maxLength={500}
              value={environmentRemarks}
              onChange={(e) => setEnvironmentRemarks(e.target.value)}
              placeholder="Ventilation, litter moisture, or fan status notes (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Hub Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            {onBackToBatches && (
              <button
                type="button"
                onClick={onBackToBatches}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                ← Back to Batches
              </button>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Daily Records</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Consolidated hub for Egg Production, Feed Consumption, Medication, Mortality, Weight,
            and Environment (Temp/Humidity). Save drafts anytime; reports aggregate all daily entries.
          </p>
        </div>

        {canCreateAny && (
          <button
            type="button"
            onClick={() => {
              if (collectorOpen) {
                setCollectorOpen(false);
              } else {
                openCollector({ focusSection: subTab });
              }
            }}
            disabled={activeBatches.length === 0 && !collectorOpen}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {collectorOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            <span>{collectorOpen ? 'Close Entry Form' : 'Record Daily Entry'}</span>
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
          recording daily operations.
        </div>
      )}

      {/* Saved Drafts Panel */}
      {dailyDrafts.length > 0 && canCreateAny && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-amber-800" />
              <h2 className="text-sm font-semibold text-amber-950">
                Saved Daily Drafts ({dailyDrafts.length})
              </h2>
            </div>
            <span className="text-xs text-amber-800">
              Incomplete sessions saved for later completion
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dailyDrafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate" title={draft.title}>
                    {draft.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Saved by {draft.createdByName}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => openCollector({ draft })}
                    className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 whitespace-nowrap"
                  >
                    <FileEdit className="h-3 w-3" />
                    <span>Resume</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteRecordDraft({ farmId: farm.farmId, draftId: draft.id });
                      setFeedback({ type: 'success', text: 'Draft discarded.' });
                    }}
                    className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                    title="Discard draft"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONSOLIDATED DAILY ENTRY WORKBENCH (Inline Grouped Form + Section Tabs) */}
      {collectorOpen && canCreateAny && (
        <section
          ref={workbenchRef}
          aria-label="Daily Records Entry Workbench"
          className="rounded-xl border border-emerald-800/30 bg-white p-5 sm:p-6"
        >
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {loadedDraftId ? 'Resume Daily Records Draft' : 'Daily Records Entry Workbench'}
              </h2>
              <p className="text-xs text-slate-500">
                Check and enter one or multiple sections together, or switch between Grouped Form and
                Section Tabs.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setEntryLayout('grouped')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    entryLayout === 'grouped'
                      ? 'bg-emerald-800 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>Grouped Form</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEntryLayout('tabbed')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    entryLayout === 'tabbed'
                      ? 'bg-emerald-800 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Section Tabs</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setCollectorOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Collapse daily entry workbench"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmitCollector} className="mt-4 space-y-5">
            {collectorError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {collectorError}
              </div>
            )}

            {/* Shared Session Context Bar */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
                  <label htmlFor="uc-batch" className="block text-xs font-medium text-slate-700">
                    Flock Batch / Pen <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="uc-batch"
                    required
                    value={selectedBatchId}
                    onChange={(e) => setSelectedBatchId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select active batch...</option>
                    {activeBatches.map((b) => {
                      const st = batchStatsMap.get(b.id);
                      return (
                        <option key={b.id} value={b.id}>
                          {b.batchCode} — {b.penNameSnapshot} (
                          {(st?.survivingBirds ?? b.initialCount).toLocaleString()} birds)
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label htmlFor="uc-date" className="block text-xs font-medium text-slate-700">
                    Record Date <span className="text-red-600">*</span>
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="uc-date"
                      type="date"
                      required
                      value={txDate}
                      onChange={(e) => setTxDate(e.target.value)}
                      className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                    />
                    <div className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900">
                      <span>{txDate ? formatIsoDateDisplay(txDate) : 'Select date'}</span>
                      <Calendar className="h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="uc-time" className="block text-xs font-medium text-slate-700">
                    Exact Time (Opt.)
                  </label>
                  <input
                    id="uc-time"
                    type="time"
                    value={txTime}
                    onChange={(e) => setTxTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-700">Session:</span>
                  {(['morning', 'afternoon', 'night'] as const).map((tod) => {
                    const meta = TIME_OF_DAY_META[tod];
                    const Icon = meta.Icon;
                    const active = timeOfDay === tod;
                    return (
                      <button
                        key={tod}
                        type="button"
                        onClick={() => setTimeOfDay(tod)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
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

                {collectorAgePreview && (
                  <div
                    className={`text-xs ${
                      collectorAgePreview.ok ? 'text-slate-700' : 'font-medium text-red-700'
                    }`}
                  >
                    {collectorAgePreview.ok ? (
                      <span>
                        Bird Age on {formatIsoDateDisplay(txDate)}:{' '}
                        <strong className="font-mono text-slate-900">{collectorAgePreview.text}</strong>
                      </span>
                    ) : (
                      <span>{collectorAgePreview.text}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Grouped Form (All 6 Sections) vs Tabbed Section Entry */}
            {entryLayout === 'grouped' ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {renderEggSectionCard(false)}
                {renderFeedSectionCard(false)}
                {renderMedicationSectionCard(false)}
                {renderMortalitySectionCard(false)}
                {renderWeightSectionCard(false)}
                {renderEnvironmentSectionCard(false)}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
                  {creatableSubTabs.map((t) => {
                    const Icon = t.Icon;
                    const active = effectiveEntryTab === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setEntryActiveTab(t.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          active
                            ? 'bg-emerald-800 text-white'
                            : 'text-slate-700 hover:bg-white hover:text-slate-900'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{t.shortLabel}</span>
                        {t.checkedInForm && (
                          <Check
                            className={`h-3 w-3 ${active ? 'text-emerald-200' : 'text-emerald-700'}`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div>
                  {effectiveEntryTab === 'egg' && renderEggSectionCard(true)}
                  {effectiveEntryTab === 'feed' && renderFeedSectionCard(true)}
                  {effectiveEntryTab === 'medication' && renderMedicationSectionCard(true)}
                  {effectiveEntryTab === 'mortality' && renderMortalitySectionCard(true)}
                  {effectiveEntryTab === 'weight' && renderWeightSectionCard(true)}
                  {effectiveEntryTab === 'environment' && renderEnvironmentSectionCard(true)}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={collectorSavingDraft || collectorSubmitting}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Bookmark className="h-4 w-4" />
                <span>{collectorSavingDraft ? 'Saving Draft...' : 'Save as Draft'}</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCollectorOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    collectorSubmitting ||
                    collectorSavingDraft ||
                    selectedSectionCount === 0 ||
                    (collectorAgePreview !== null && !collectorAgePreview.ok)
                  }
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  {collectorSubmitting
                    ? 'Submitting...'
                    : `Submit Selected (${selectedSectionCount})`}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* Ledger & Trends Sub-Navigation Tabs (Zero-Pill Counts) */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5">
        {visibleSubTabs.map((t) => {
          const Icon = t.Icon;
          const active = effectiveSubTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{t.label}</span>
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  active ? 'text-emerald-200' : 'text-slate-400'
                }`}
              >
                {t.countLabel ?? t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Shared Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor="dp-start" className="block text-xs font-medium text-slate-600">
            From Date
          </label>
          <input
            id="dp-start"
            type="date"
            value={effectiveSubTab === 'trends' ? last7DaysTrends[0]?.date || startDate : startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={effectiveSubTab === 'trends' || effectiveSubTab === 'reminders'}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono disabled:bg-slate-100 disabled:text-slate-500"
          />
        </div>
        <div>
          <label htmlFor="dp-end" className="block text-xs font-medium text-slate-600">
            To Date
          </label>
          <input
            id="dp-end"
            type="date"
            value={effectiveSubTab === 'trends' ? todayStr : endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={effectiveSubTab === 'trends' || effectiveSubTab === 'reminders'}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono disabled:bg-slate-100 disabled:text-slate-500"
          />
        </div>
        <div>
          <label htmlFor="dp-batch" className="block text-xs font-medium text-slate-600">
            Flock Batch / Pen
          </label>
          <select
            id="dp-batch"
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
          >
            <option value="all">All Batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchCode} — {b.penNameSnapshot} ({b.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dp-tod" className="block text-xs font-medium text-slate-600">
            Time of Day
          </label>
          <select
            id="dp-tod"
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as 'all' | TimeOfDay)}
            disabled={
              effectiveSubTab === 'egg' ||
              effectiveSubTab === 'feed' ||
              effectiveSubTab === 'trends' ||
              effectiveSubTab === 'reminders'
            }
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:bg-slate-100 disabled:text-slate-400"
          >
            <option value="all">All Times</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="night">Night</option>
          </select>
        </div>
        <div className="flex items-end pb-1">
          <label
            className={`inline-flex items-center gap-2 text-xs ${
              effectiveSubTab === 'trends' || effectiveSubTab === 'reminders'
                ? 'cursor-not-allowed text-slate-400'
                : 'cursor-pointer text-slate-700'
            }`}
          >
            <input
              type="checkbox"
              checked={
                effectiveSubTab === 'trends' || effectiveSubTab === 'reminders' ? false : showVoided
              }
              disabled={effectiveSubTab === 'trends' || effectiveSubTab === 'reminders'}
              onChange={(e) => setShowVoided(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-800 disabled:opacity-50"
            />
            <span>Include voided entries</span>
          </label>
        </div>
      </div>

      {/* TAB 1: EGG PRODUCTION */}
      {effectiveSubTab === 'egg' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4 tabular-nums">
            <div>
              <p className="text-xs text-slate-500">Pickups Logged</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {eggSummary.entries}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Intact Eggs</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-emerald-800">
                {eggSummary.intactEggs.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500">
                {Math.floor(eggSummary.intactEggs / 30)} crates + {eggSummary.intactEggs % 30} pcs
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Cracked / Damaged</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-amber-700">
                {eggSummary.crackedEggs.toLocaleString()} / {eggSummary.damagedEggs.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Grand Total Eggs</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {eggSummary.totalEggs.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filteredProd.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-slate-800">
                  No egg production entries in this filter.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Use &quot;Record Daily Entry&quot; above to log morning, afternoon, or night egg pickups.
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
                    {filteredProd.map((e) => (
                      <tr
                        key={e.id}
                        className={e.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}
                      >
                        <td className="px-4 py-3 font-mono whitespace-nowrap">
                          <div className={e.isVoided ? 'line-through' : 'font-medium text-slate-900'}>
                            {formatIsoDateDisplay(e.transactionDate)}
                          </div>
                          <div className="text-[11px] text-slate-500">{e.transactionTime || '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{e.batchCodeSnapshot}</div>
                          <div className="text-slate-500">{e.penNameSnapshot}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
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
                            <div
                              className="max-w-[180px] truncate text-[11px] text-slate-500"
                              title={e.remarks}
                            >
                              {e.remarks}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!e.isVoided && (
                            <div className="inline-flex items-center gap-2">
                              {canEditProd && (
                                <button
                                  type="button"
                                  onClick={() => startEditEgg(e)}
                                  className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                  title="Edit entry"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canDeleteProd && (
                                <button
                                  type="button"
                                  onClick={() => setVoidTarget({ kind: 'egg', item: e })}
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
        </div>
      )}

      {/* TAB 2: FEED CONSUMPTION */}
      {effectiveSubTab === 'feed' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 tabular-nums">
            <div>
              <p className="text-xs text-slate-500">Feeding Issues Logged</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {feedSummary.entries}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Feed Issued</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-emerald-800">
                {(feedSummary.grams / 1000).toLocaleString('en-NG', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                kg
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Locked Historical Cost</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {formatNgn(feedSummary.costNgn)}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filteredCons.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-slate-800">
                  No feed consumption entries in this filter.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Feed purchases &amp; stock-in are managed in Purchases &amp; Stock; daily batch
                  feeding is logged here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-4 py-3 font-medium">Date / Time</th>
                      <th className="px-4 py-3 font-medium">Batch / Pen</th>
                      <th className="px-4 py-3 font-medium">Feed / Brand</th>
                      <th className="px-4 py-3 text-right font-medium">Entered</th>
                      <th className="px-4 py-3 text-right font-medium">Std. (kg)</th>
                      <th className="px-4 py-3 text-right font-medium">Cost Snapshot</th>
                      <th className="px-4 py-3 font-medium">Cost Source</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {filteredCons.map((c) => (
                      <tr
                        key={c.id}
                        className={c.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}
                      >
                        <td className="px-4 py-3 font-mono whitespace-nowrap">
                          <div className={c.isVoided ? 'line-through' : 'font-medium text-slate-900'}>
                            {formatIsoDateDisplay(c.transactionDate)}
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
                          {!c.isVoided && c.remarks && (
                            <div
                              className="font-sans max-w-[160px] truncate text-[11px] text-slate-500"
                              title={c.remarks}
                            >
                              {c.remarks}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!c.isVoided && (
                            <div className="inline-flex items-center gap-2">
                              {canEditFeed && (
                                <button
                                  type="button"
                                  onClick={() => startEditFeed(c)}
                                  className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                  title="Edit date/remarks"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canDeleteFeed && (
                                <button
                                  type="button"
                                  onClick={() => setVoidTarget({ kind: 'feed', item: c })}
                                  className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                                  title="Void & restore feed stock"
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
        </div>
      )}

      {/* TAB 3: MEDICATION */}
      {effectiveSubTab === 'medication' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {filteredMeds.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-800">
                No medication or vaccination logs in this filter.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Record flock medications, vaccines, vitamins, or deworming using &quot;Record Daily
                Entry&quot;.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-4 py-3 font-medium">Date &amp; Session</th>
                    <th className="px-4 py-3 font-medium">Batch / Pen</th>
                    <th className="px-4 py-3 font-medium">Treatment</th>
                    <th className="px-4 py-3 font-medium">Dosage &amp; Route</th>
                    <th className="px-4 py-3 font-medium">Recorded By</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredMeds.map((m) => {
                    const tMeta = TIME_OF_DAY_META[m.timeOfDay] || TIME_OF_DAY_META.morning;
                    const TIcon = tMeta.Icon;
                    return (
                      <tr
                        key={m.id}
                        className={m.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className={`font-mono ${m.isVoided ? 'line-through' : 'font-medium text-slate-900'}`}>
                            {formatIsoDateDisplay(m.transactionDate)}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                            <span className={`inline-flex items-center gap-1 font-medium ${tMeta.textClass}`}>
                              <TIcon className="h-3 w-3" />
                              <span>{tMeta.label}</span>
                            </span>
                            {m.transactionTime && (
                              <span className="font-mono text-slate-500">· {m.transactionTime}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{m.batchCodeSnapshot}</div>
                          <div className="text-slate-500">
                            {m.penNameSnapshot} · {formatBirdAge(m.birdAgeDaysAtTransaction)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{m.medicationName}</div>
                          <div className="capitalize text-slate-500">{m.treatmentType}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{m.dosage}</div>
                          <div className="text-slate-500">{m.administrationRoute}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{m.createdByName}</div>
                          {m.isVoided && (
                            <div className="text-[11px] font-medium text-red-700">
                              VOIDED: {m.voidReason}
                            </div>
                          )}
                          {!m.isVoided && m.remarks && (
                            <div
                              className="max-w-[180px] truncate text-[11px] text-slate-500"
                              title={m.remarks}
                            >
                              {m.remarks}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!m.isVoided && (
                            <div className="inline-flex items-center gap-2">
                              {canEditProd && (
                                <button
                                  type="button"
                                  onClick={() => startEditMed(m)}
                                  className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                  title="Edit medication log"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canDeleteProd && (
                                <button
                                  type="button"
                                  onClick={() => setVoidTarget({ kind: 'medication', item: m })}
                                  className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                                  title="Void medication log"
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
      )}

      {/* TAB 4: MORTALITY */}
      {effectiveSubTab === 'mortality' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 tabular-nums">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Active Flocks Survival Rate</p>
              <p className="mt-1 font-mono text-2xl font-bold text-emerald-800">
                {activeFlockHealth.survivalPct.toFixed(2)}%
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {activeFlockHealth.surviving.toLocaleString()} /{' '}
                {activeFlockHealth.initial.toLocaleString()} surviving
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Filtered Period Losses</p>
              <p className="mt-1 font-mono text-2xl font-bold text-red-700">
                {filteredMortality
                  .filter((m) => !m.isVoided)
                  .reduce((s, m) => s + m.mortalityCount, 0)
                  .toLocaleString()}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {filteredMortality.filter((m) => !m.isVoided).length} non-voided entries
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Time-of-Day Breakdown</p>
              <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs">
                <span className="text-amber-800">
                  AM:{' '}
                  <strong>
                    {filteredMortality
                      .filter((m) => !m.isVoided && m.timeOfDay === 'morning')
                      .reduce((s, m) => s + m.mortalityCount, 0)}
                  </strong>
                </span>
                <span className="text-sky-800">
                  PM:{' '}
                  <strong>
                    {filteredMortality
                      .filter((m) => !m.isVoided && m.timeOfDay === 'afternoon')
                      .reduce((s, m) => s + m.mortalityCount, 0)}
                  </strong>
                </span>
                <span className="text-indigo-800">
                  Night:{' '}
                  <strong>
                    {filteredMortality
                      .filter((m) => !m.isVoided && m.timeOfDay === 'night')
                      .reduce((s, m) => s + m.mortalityCount, 0)}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Pen &amp; Batch Survival Scorecard (All-Time Cumulative)
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Batch / Pen</th>
                    <th className="py-2 px-3 text-right font-medium">Initial</th>
                    <th className="py-2 px-3 text-right font-medium">Lost</th>
                    <th className="py-2 px-3 text-right font-medium">Surviving</th>
                    <th className="py-2 px-3 text-right font-medium">Survival %</th>
                    <th className="py-2 pl-3 text-right font-medium">Quick Log</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {batches
                    .filter((b) => batchFilter === 'all' || b.id === batchFilter)
                    .map((b) => {
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
                          <td className="py-2 pr-3">
                            <span className="font-semibold text-slate-900">{b.batchCode}</span> ·{' '}
                            <span className="text-slate-500">{b.penNameSnapshot}</span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            {stats.initialCount.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-red-700">
                            {stats.totalLosses.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">
                            {stats.survivingBirds.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-800">
                            {stats.survivalRatePct.toFixed(2)}%
                          </td>
                          <td className="py-2 pl-3 text-right">
                            {canCreateMortality && b.status === 'active' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  openCollector({ focusSection: 'mortality', batchId: b.id })
                                }
                                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 whitespace-nowrap"
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
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filteredMortality.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-slate-800">
                  No mortality entries in this filter.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-4 py-3 font-medium">Date &amp; Session</th>
                      <th className="px-4 py-3 font-medium">Batch / Pen</th>
                      <th className="px-4 py-3 font-medium">Bird Age</th>
                      <th className="px-4 py-3 text-right font-medium">Birds Lost</th>
                      <th className="px-4 py-3 font-medium">Reason for Death</th>
                      <th className="px-4 py-3 font-medium">Recorded By</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {filteredMortality.map((entry) => {
                      const tMeta = TIME_OF_DAY_META[entry.timeOfDay] || TIME_OF_DAY_META.morning;
                      const TIcon = tMeta.Icon;
                      return (
                        <tr
                          key={entry.id}
                          className={
                            entry.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'
                          }
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div
                              className={`font-mono ${
                                entry.isVoided ? 'line-through' : 'font-medium text-slate-900'
                              }`}
                            >
                              {formatIsoDateDisplay(entry.transactionDate)}
                            </div>
                            <div className="mt-0.5">
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] font-medium ${tMeta.textClass}`}
                              >
                                <TIcon className="h-3 w-3" />
                                <span>{tMeta.label}</span>
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
                                className="max-w-[200px] truncate text-[11px] text-slate-500"
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
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!entry.isVoided && (
                              <div className="inline-flex items-center gap-2">
                                {canEditMortality && (
                                  <button
                                    type="button"
                                    onClick={() => startEditMort(entry)}
                                    className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                    title="Edit mortality entry"
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canDeleteMortality && (
                                  <button
                                    type="button"
                                    onClick={() => setVoidTarget({ kind: 'mortality', item: entry })}
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
        </div>
      )}

      {/* TAB 5: WEIGHT */}
      {effectiveSubTab === 'weight' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4 tabular-nums">
            <div>
              <p className="text-xs text-slate-500">Weighings Logged</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {weightSummary.entries}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Avg. Bird Weight</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-emerald-800">
                {weightSummary.avgWeightG !== null
                  ? `${weightSummary.avgWeightG.toLocaleString()} g`
                  : '—'}
              </p>
              {weightSummary.avgWeightG !== null && (
                <p className="text-[11px] text-slate-500 font-mono">
                  {(weightSummary.avgWeightG / 1000).toFixed(2)} kg / bird
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-500">Latest Reading</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {weightSummary.latestWeightG !== null
                  ? `${weightSummary.latestWeightG.toLocaleString()} g`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Birds Sampled</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {weightSummary.totalSamples.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filteredWeight.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-slate-800">
                  No bird weight samples in this filter.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Use &quot;Record Daily Entry&quot; to log flock average body weights and sample sizes.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-4 py-3 font-medium">Date &amp; Session</th>
                      <th className="px-4 py-3 font-medium">Batch / Pen</th>
                      <th className="px-4 py-3 font-medium">Bird Age</th>
                      <th className="px-4 py-3 text-right font-medium">Avg Weight (g)</th>
                      <th className="px-4 py-3 text-right font-medium">Weight (kg)</th>
                      <th className="px-4 py-3 text-right font-medium">Sample Size</th>
                      <th className="px-4 py-3 font-medium">Recorded By</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {filteredWeight.map((e) => {
                      const tMeta = TIME_OF_DAY_META[e.timeOfDay] || TIME_OF_DAY_META.morning;
                      const TIcon = tMeta.Icon;
                      const wGrams = e.averageWeightGrams as number;
                      return (
                        <tr
                          key={e.id}
                          className={e.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div
                              className={`font-mono ${
                                e.isVoided ? 'line-through' : 'font-medium text-slate-900'
                              }`}
                            >
                              {formatIsoDateDisplay(e.transactionDate)}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                              <span
                                className={`inline-flex items-center gap-1 font-medium ${tMeta.textClass}`}
                              >
                                <TIcon className="h-3 w-3" />
                                <span>{tMeta.label}</span>
                              </span>
                              {e.transactionTime && (
                                <span className="font-mono text-slate-500">· {e.transactionTime}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{e.batchCodeSnapshot}</div>
                            <div className="text-slate-500">{e.penNameSnapshot}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                            {formatBirdAge(e.birdAgeDaysAtTransaction)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                            {wGrams.toLocaleString()} g
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-800">
                            {(wGrams / 1000).toFixed(2)} kg
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-700">
                            {e.sampleSize > 0 ? `${e.sampleSize} birds` : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div>{e.createdByName}</div>
                            {e.isVoided && (
                              <div className="text-[11px] font-medium text-red-700">
                                VOIDED: {e.voidReason}
                              </div>
                            )}
                            {!e.isVoided && e.remarks && (
                              <div
                                className="max-w-[160px] truncate text-[11px] text-slate-500"
                                title={e.remarks}
                              >
                                {e.remarks}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!e.isVoided && (
                              <div className="inline-flex items-center gap-2">
                                {canEditProd && (
                                  <button
                                    type="button"
                                    onClick={() => startEditEnv(e, 'weight')}
                                    className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                    title="Edit weight sample"
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canDeleteProd && (
                                  <button
                                    type="button"
                                    onClick={() => setVoidTarget({ kind: 'weight', item: e })}
                                    className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                                    title="Void weight sample"
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
        </div>
      )}

      {/* TAB 6: ENVIRONMENT (TEMPERATURE & HUMIDITY) */}
      {effectiveSubTab === 'environment' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 tabular-nums">
            <div>
              <p className="text-xs text-slate-500">Readings Logged</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {envSummary.entries}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Avg. Pen Temperature</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">
                {envSummary.avgTempC !== null ? `${envSummary.avgTempC} °C` : '—'}
              </p>
              {envSummary.minTempC !== null && envSummary.maxTempC !== null && (
                <p className="text-[11px] text-slate-500 font-mono">
                  Range: {envSummary.minTempC}° – {envSummary.maxTempC}°C
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-500">Avg. Relative Humidity</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-emerald-800">
                {envSummary.avgHumidityPct !== null ? `${envSummary.avgHumidityPct}%` : '—'}
              </p>
              {envSummary.minHumidityPct !== null && envSummary.maxHumidityPct !== null && (
                <p className="text-[11px] text-slate-500 font-mono">
                  Range: {envSummary.minHumidityPct}% – {envSummary.maxHumidityPct}%
                </p>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filteredEnv.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-slate-800">
                  No temperature or humidity readings in this filter.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Use &quot;Record Daily Entry&quot; to capture morning, afternoon, or night pen
                  climate readings.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-4 py-3 font-medium">Date &amp; Session</th>
                      <th className="px-4 py-3 font-medium">Batch / Pen</th>
                      <th className="px-4 py-3 text-right font-medium">Temperature</th>
                      <th className="px-4 py-3 text-right font-medium">Humidity</th>
                      <th className="px-4 py-3 font-medium">Recorded By</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {filteredEnv.map((e) => {
                      const tMeta = TIME_OF_DAY_META[e.timeOfDay] || TIME_OF_DAY_META.morning;
                      const TIcon = tMeta.Icon;
                      return (
                        <tr
                          key={e.id}
                          className={e.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div
                              className={`font-mono ${
                                e.isVoided ? 'line-through' : 'font-medium text-slate-900'
                              }`}
                            >
                              {formatIsoDateDisplay(e.transactionDate)}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                              <span
                                className={`inline-flex items-center gap-1 font-medium ${tMeta.textClass}`}
                              >
                                <TIcon className="h-3 w-3" />
                                <span>{tMeta.label}</span>
                              </span>
                              {e.transactionTime && (
                                <span className="font-mono text-slate-500">· {e.transactionTime}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{e.batchCodeSnapshot}</div>
                            <div className="text-slate-500">{e.penNameSnapshot}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                            {e.temperatureC !== null ? `${e.temperatureC} °C` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-800">
                            {e.humidityPct !== null ? `${e.humidityPct}%` : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div>{e.createdByName}</div>
                            {e.isVoided && (
                              <div className="text-[11px] font-medium text-red-700">
                                VOIDED: {e.voidReason}
                              </div>
                            )}
                            {!e.isVoided && e.remarks && (
                              <div
                                className="max-w-[160px] truncate text-[11px] text-slate-500"
                                title={e.remarks}
                              >
                                {e.remarks}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!e.isVoided && (
                              <div className="inline-flex items-center gap-2">
                                {canEditProd && (
                                  <button
                                    type="button"
                                    onClick={() => startEditEnv(e, 'environment')}
                                    className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                    title="Edit environment reading"
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canDeleteProd && (
                                  <button
                                    type="button"
                                    onClick={() => setVoidTarget({ kind: 'environment', item: e })}
                                    className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                                    title="Void environment reading"
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
        </div>
      )}

      {/* TAB 7: TRENDS (LAST 7 DAYS D3 CHARTS) */}
      {effectiveSubTab === 'trends' && (
        <DailyTrendsCharts
          points={last7DaysTrends}
          canReadProd={canReadProd}
          canReadFeed={canReadFeed}
          canCreateAny={canCreateAny && activeBatches.length > 0}
          scopedBatchLabel={scopedBatchLabel}
          onLogDailyEntry={() => openCollector({ focusSection: 'egg' })}
        />
      )}

      {/* TAB 8: REMINDERS (SCHEDULED VACCINATIONS & BATCH AGE MILESTONES) */}
      {effectiveSubTab === 'reminders' && (
        <DailyRemindersPanel
          farm={farm}
          member={member}
          todayStr={todayStr}
          batches={batches}
          activeBatches={activeBatches}
          reminders={farmReminders}
          timelineItems={remindersTimeline}
          batchFilter={batchFilter}
          scopedBatchLabel={scopedBatchLabel}
          canCreateReminder={canCreateProd || canCreateMortality}
          canEditReminder={canEditProd || canEditMortality}
          canLogMedication={canCreateProd}
          onLogTreatmentFromReminder={(preset) =>
            openCollector({
              focusSection: 'medication',
              batchId: preset.batchId,
              layout: 'tabbed',
              presetMedication: {
                treatmentType: preset.treatmentType,
                medicationName: preset.medicationName,
                dosage: preset.dosage,
              },
            })
          }
          onFeedback={setFeedback}
        />
      )}

      {/* EDIT ENTRY MODAL (Per-record corrections preserving business rules) */}
      {(editEgg || editFeed || editMed || editMort || editEnv) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">
                {editEgg
                  ? 'Edit Egg Production Entry'
                  : editFeed
                  ? 'Edit Feed Consumption Notes'
                  : editMed
                  ? 'Edit Medication Log'
                  : editMort
                  ? 'Edit Mortality Entry'
                  : editEnv?.mode === 'weight'
                  ? 'Edit Bird Weight Sample'
                  : 'Edit Environment Reading'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setEditEgg(null);
                  setEditFeed(null);
                  setEditMed(null);
                  setEditMort(null);
                  setEditEnv(null);
                }}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              {editError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {editError}
                </div>
              )}

              {!editFeed && (
                <div>
                  <label className="block text-xs font-medium text-slate-700">Batch</label>
                  <select
                    value={eBatchId}
                    onChange={(e) => setEBatchId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batchCode} — {b.penNameSnapshot}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Date</label>
                  <input
                    type="date"
                    required
                    value={eDate}
                    onChange={(e) => setEDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                {!editMort && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Time</label>
                    <input
                      type="time"
                      value={eTime}
                      onChange={(e) => setETime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                )}
              </div>

              {(editMed || editMort || editEnv) && (
                <div>
                  <span className="block text-xs font-medium text-slate-700">Time of Day</span>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {(['morning', 'afternoon', 'night'] as const).map((tod) => (
                      <button
                        key={tod}
                        type="button"
                        onClick={() => setETod(tod)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize ${
                          eTod === tod
                            ? 'border-emerald-800 bg-emerald-800 text-white'
                            : 'border-slate-300 text-slate-700'
                        }`}
                      >
                        {tod}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {editEgg && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Crates</label>
                    <input
                      type="number"
                      min={0}
                      value={eCrates}
                      onChange={(e) => setECrates(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Pieces</label>
                    <input
                      type="number"
                      min={0}
                      value={ePieces}
                      onChange={(e) => setEPieces(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Cracked</label>
                    <input
                      type="number"
                      min={0}
                      value={eCracked}
                      onChange={(e) => setECracked(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Damaged</label>
                    <input
                      type="number"
                      min={0}
                      value={eDamaged}
                      onChange={(e) => setEDamaged(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                </div>
              )}

              {editFeed && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Quantity ({editFeed.enteredQuantity} {editFeed.enteredUnit}) and locked historical
                  cost ({formatNgn(editFeed.totalCostNgn)}) remain preserved. To change quantity,
                  void and re-enter.
                </div>
              )}

              {editMed && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Treatment Type</label>
                    <select
                      value={eMedType}
                      onChange={(e) => setEMedType(e.target.value as MedicationTreatmentType)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    >
                      {MEDICATION_TREATMENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Medication Name</label>
                    <input
                      type="text"
                      required
                      value={eMedName}
                      onChange={(e) => setEMedName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Dosage</label>
                    <input
                      type="text"
                      required
                      value={eDosage}
                      onChange={(e) => setEDosage(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Route</label>
                    <select
                      value={eRoute}
                      onChange={(e) => setERoute(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    >
                      {ADMINISTRATION_ROUTES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {editMort && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Birds Lost</label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={eMortCount}
                        onChange={(e) => setEMortCount(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Reason</label>
                      <select
                        value={eMortReason}
                        onChange={(e) => setEMortReason(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      >
                        {MORTALITY_REASON_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={eMortDetail}
                    onChange={(e) => setEMortDetail(e.target.value)}
                    placeholder="Reason details"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
              )}

              {editEnv?.mode === 'weight' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Avg Weight (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      required
                      value={eWeight}
                      onChange={(e) => setEWeight(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Sample Size</label>
                    <input
                      type="number"
                      min={0}
                      value={eSample}
                      onChange={(e) => setESample(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                </div>
              )}

              {editEnv?.mode === 'environment' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Temperature (°C)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="-10"
                      max="70"
                      value={eTemp}
                      onChange={(e) => setETemp(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Humidity (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={eHum}
                      onChange={(e) => setEHum(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700">Remarks</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={eRemarks}
                  onChange={(e) => setERemarks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditEgg(null);
                    setEditFeed(null);
                    setEditMed(null);
                    setEditMort(null);
                    setEditEnv(null);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
                >
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VOID CONFIRM MODAL */}
      <ConfirmVoidModal
        open={Boolean(voidTarget)}
        title="Void Daily Record?"
        description={
          voidTarget?.kind === 'feed'
            ? `Voiding this feed consumption (${voidTarget.item.enteredQuantity} ${voidTarget.item.enteredUnit}) will atomically restore ${(voidTarget.item.standardizedGrams / 1000).toFixed(2)} kg back to feed stock.`
            : 'Voiding excludes this record from reports and batch totals while preserving complete audit history.'
        }
        confirmLabel="Void Record"
        onConfirm={async (reason) => {
          if (!voidTarget) return;
          if (voidTarget.kind === 'egg') {
            await voidEggProduction({
              farmId: farm.farmId,
              entry: voidTarget.item,
              voidReason: reason,
              actorUid: member.uid,
              actorName: member.displayName,
            });
          } else if (voidTarget.kind === 'feed') {
            await voidFeedConsumption({
              farmId: farm.farmId,
              consumption: voidTarget.item,
              voidReason: reason,
              actorUid: member.uid,
              actorName: member.displayName,
            });
          } else if (voidTarget.kind === 'medication') {
            await voidMedicationLog({
              farmId: farm.farmId,
              entry: voidTarget.item,
              voidReason: reason,
              actorUid: member.uid,
              actorName: member.displayName,
            });
          } else if (voidTarget.kind === 'mortality') {
            await voidMortalityEntry({
              farmId: farm.farmId,
              entry: voidTarget.item,
              voidReason: reason,
              actorUid: member.uid,
              actorName: member.displayName,
            });
          } else if (voidTarget.kind === 'weight' || voidTarget.kind === 'environment') {
            await voidEnvironmentLog({
              farmId: farm.farmId,
              entry: voidTarget.item,
              voidReason: reason,
              actorUid: member.uid,
              actorName: member.displayName,
            });
          }
          setFeedback({ type: 'success', text: 'Record voided.' });
        }}
        onClose={() => setVoidTarget(null)}
      />
    </div>
  );
};
