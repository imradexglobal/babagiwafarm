import type {
  DateFilterPreset,
  DepartmentType,
  EggProductionEntry,
  EggSale,
  FarmMember,
  FarmPurchase,
  FarmReminder,
  FeedConsumption,
  FeedPurchase,
  FeedUnit,
  MortalityEntry,
  PermissionsMatrix,
  PoultryBatch,
  RecurrenceUnit,
  ReminderStatus,
  ReminderType,
} from '../types/farm.ts';

export const EGGS_PER_CRATE = 30;
export const DEFAULT_BAG_WEIGHT_KG = 25;
export const DEFAULT_TIMEZONE = 'Africa/Lagos';

/** Percentage of live hens laying intact eggs on a given day. */
export function calculateHenDayRate(intactEggs: number, liveBirds: number): number {
  if (![intactEggs, liveBirds].every(Number.isFinite) || intactEggs < 0 || liveBirds <= 0) return 0;
  return Math.round((intactEggs / liveBirds) * 10000) / 100;
}

/** Percentage of the originally housed flock represented by today's intact eggs. */
export function calculateHenHousedRate(intactEggs: number, initialBirds: number): number {
  if (![intactEggs, initialBirds].every(Number.isFinite) || intactEggs < 0 || initialBirds <= 0) return 0;
  return Math.round((intactEggs / initialBirds) * 10000) / 100;
}

/** Feed kg per production unit (egg mass/dozens for layers, weight gain kg for broilers). */
export function calculateFeedConversionRatio(
  totalFeedKg: number,
  productionMetric: number,
  type: 'layer' | 'broiler'
): number {
  if (!['layer', 'broiler'].includes(type) || !Number.isFinite(totalFeedKg) || totalFeedKg < 0 || !Number.isFinite(productionMetric) || productionMetric <= 0) return 0;
  return Math.round((totalFeedKg / productionMetric) * 10000) / 10000;
}

/** Batch expense allocated over intact eggs produced (NGN/egg). */
export function calculateCostPerEgg(totalBatchCostNgn: number, totalIntactEggs: number): number {
  if (!Number.isFinite(totalBatchCostNgn) || totalBatchCostNgn < 0 || !Number.isFinite(totalIntactEggs) || totalIntactEggs <= 0) return 0;
  return Math.round((totalBatchCostNgn / totalIntactEggs) * 100) / 100;
}

/** Batch expense per kg of current live body weight (NGN/kg). */
export function calculateCostPerKgBodyWeight(totalBatchCostNgn: number, liveBirds: number, avgWeightKg: number): number {
  const liveWeightKg = liveBirds * avgWeightKg;
  if (!Number.isFinite(totalBatchCostNgn) || totalBatchCostNgn < 0 || !Number.isFinite(liveWeightKg) || liveWeightKg <= 0) return 0;
  return Math.round((totalBatchCostNgn / liveWeightKg) * 100) / 100;
}

export const OWNER_FULL_PERMISSIONS: PermissionsMatrix = {
  batches: { read: true, create: true, edit: true, delete: true },
  production: { read: true, create: true, edit: true, delete: true, approve: true },
  feed: { read: true, create: true, edit: true, delete: true },
  sales: { read: true, create: true, edit: true, delete: true, overridePrice: true },
  reports: { read: true, export: true },
  settings: { read: true, edit: true },
  members: { read: true, manage: true },
  eggStore: { read: true, transfer: true, receive: true, sort: true, adjust: true, distribute: true, dispose: true },
};

export const DEFAULT_STAFF_PERMISSIONS: PermissionsMatrix = {
  batches: { read: true, create: false, edit: false, delete: false },
  production: { read: true, create: true, edit: false, delete: false, approve: false },
  feed: { read: true, create: true, edit: false, delete: false },
  sales: { read: true, create: true, edit: false, delete: false, overridePrice: false },
  reports: { read: true, export: false },
  settings: { read: false, edit: false },
  members: { read: false, manage: false },
  eggStore: { read: true, transfer: true, receive: true, sort: true, adjust: false, distribute: false, dispose: false },
};

/** Adds safe defaults for the Egg Store domain when editing pre-upgrade staff records. */
export function normalizePermissions(permissions: Partial<PermissionsMatrix> | undefined): PermissionsMatrix {
  const defaults = DEFAULT_STAFF_PERMISSIONS;
  return {
    batches: { ...defaults.batches, ...permissions?.batches },
    production: { ...defaults.production, ...permissions?.production },
    feed: { ...defaults.feed, ...permissions?.feed },
    sales: { ...defaults.sales, ...permissions?.sales },
    reports: { ...defaults.reports, ...permissions?.reports },
    settings: { ...defaults.settings, ...permissions?.settings },
    members: { ...defaults.members, ...permissions?.members },
    eggStore: { ...defaults.eggStore, ...permissions?.eggStore },
  };
}

export function hasPermission(
  member: FarmMember | null,
  domain: keyof PermissionsMatrix,
  action: string
): boolean {
  if (!member || member.status !== 'active') return false;
  if (member.role === 'owner') return true;
  const domainPerms = member.permissions?.[domain] as unknown as Record<string, boolean> | undefined;
  return Boolean(domainPerms?.[action]);
}

export function generateId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`;
}

export function toEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

export function toCodeKey(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'code';
}

export function parseIsoDateUtcMs(dateStr: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format "${dateStr}". Expected YYYY-MM-DD.`);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function diffDays(startDateStr: string, endDateStr: string): number {
  const startMs = parseIsoDateUtcMs(startDateStr);
  const endMs = parseIsoDateUtcMs(endDateStr);
  return Math.round((endMs - startMs) / 86_400_000);
}

export function calculateBirdAgeDays(params: {
  hatchDate: string;
  placementDate: string;
  ageAtPlacementDays: number;
  transactionDate: string;
}): number {
  const { hatchDate, placementDate, ageAtPlacementDays, transactionDate } = params;
  if (!Number.isInteger(ageAtPlacementDays) || ageAtPlacementDays < 0) {
    throw new Error('Age at placement must be a non-negative integer.');
  }

  const daysSincePlacement = diffDays(placementDate, transactionDate);
  if (daysSincePlacement < 0) {
    throw new Error(
      `Transaction date (${transactionDate}) cannot be earlier than batch placement date (${placementDate}).`
    );
  }

  if (hatchDate && hatchDate.trim().length > 0) {
    const daysFromHatch = diffDays(hatchDate, transactionDate);
    if (daysFromHatch < 0) {
      throw new Error(
        `Transaction date (${transactionDate}) cannot be earlier than hatch date (${hatchDate}).`
      );
    }
    return daysFromHatch;
  }

  return ageAtPlacementDays + daysSincePlacement;
}

export function formatBirdAge(days: number): string {
  if (!Number.isFinite(days) || days < 0) return '0 d';
  const weeks = Math.floor(days / 7);
  const remDays = days % 7;
  if (weeks === 0) return `${remDays} d`;
  return `${weeks}w ${remDays}d (${days} d)`;
}

export function calculateEggCounts(params: {
  crates: number;
  pieces: number;
  crackedEggs: number;
  damagedEggs: number;
}): { intactEggs: number; totalEggs: number } {
  const { crates, pieces, crackedEggs, damagedEggs } = params;
  const values = [
    { label: 'Crates', val: crates },
    { label: 'Pieces', val: pieces },
    { label: 'Cracked eggs', val: crackedEggs },
    { label: 'Damaged eggs', val: damagedEggs },
  ];
  for (const item of values) {
    if (!Number.isInteger(item.val) || item.val < 0) {
      throw new Error(`${item.label} must be a non-negative whole number.`);
    }
  }
  const intactEggs = crates * EGGS_PER_CRATE + pieces;
  const totalEggs = intactEggs + crackedEggs + damagedEggs;
  if (totalEggs <= 0) {
    throw new Error('Total collected eggs must be greater than zero.');
  }
  return { intactEggs, totalEggs };
}

export interface BatchMortalityStats {
  initialCount: number;
  totalLosses: number;
  survivingBirds: number;
  mortalityRatePct: number;
  survivalRatePct: number;
  entryCount: number;
}

export function calculateBatchMortalityStats(
  batch: Pick<PoultryBatch, 'id' | 'initialCount'>,
  entries: MortalityEntry[]
): BatchMortalityStats {
  let totalLosses = 0;
  let entryCount = 0;
  for (const e of entries) {
    if (!e.isVoided && e.batchId === batch.id) {
      totalLosses += e.mortalityCount;
      entryCount += 1;
    }
  }
  const initialCount = Math.max(0, batch.initialCount);
  const clampedLosses = Math.min(totalLosses, initialCount);
  const survivingBirds = Math.max(0, initialCount - totalLosses);
  const mortalityRatePct =
    initialCount > 0 ? Math.round((clampedLosses / initialCount) * 10000) / 100 : 0;
  const survivalRatePct =
    initialCount > 0 ? Math.round((survivingBirds / initialCount) * 10000) / 100 : 0;

  return {
    initialCount,
    totalLosses,
    survivingBirds,
    mortalityRatePct,
    survivalRatePct,
    entryCount,
  };
}

export interface BatchFinancialSummary {
  batchId: string;
  eggsProduced: number;
  directSalesRevenueNgn: number;
  pooledSalesRevenueNgn: number;
  totalRevenueNgn: number;
  feedExpenseNgn: number;
  medicationExpenseNgn: number;
  directOtherExpenseNgn: number;
  totalExpenseNgn: number;
  netProfitNgn: number;
  profitMarginPct: number;
}

export function calculateBatchFinancialSummaries(params: {
  batches: Pick<PoultryBatch, 'id'>[];
  production: Pick<EggProductionEntry, 'batchId' | 'totalEggs' | 'isVoided' | 'status'>[];
  consumptions: Pick<FeedConsumption, 'batchId' | 'totalCostNgn' | 'isVoided'>[];
  sales: Pick<EggSale, 'batchId' | 'totalAmountNgn' | 'isVoided'>[];
  farmPurchases?: Pick<FarmPurchase, 'batchId' | 'totalCostNgn' | 'isVoided' | 'category'>[];
}): Map<string, BatchFinancialSummary> {
  const eggsByBatch = new Map<string, number>();
  let totalFarmEggs = 0;
  for (const p of params.production) {
    if (p.isVoided || (p.status !== undefined && p.status !== 'APPROVED')) continue;
    eggsByBatch.set(p.batchId, (eggsByBatch.get(p.batchId) || 0) + p.totalEggs);
    totalFarmEggs += p.totalEggs;
  }

  const directSalesByBatch = new Map<string, number>();
  let pooledSalesNgn = 0;
  for (const s of params.sales) {
    if (s.isVoided) continue;
    if (s.batchId) {
      directSalesByBatch.set(
        s.batchId,
        (directSalesByBatch.get(s.batchId) || 0) + s.totalAmountNgn
      );
    } else {
      pooledSalesNgn += s.totalAmountNgn;
    }
  }

  const feedExpenseByBatch = new Map<string, number>();
  for (const c of params.consumptions) {
    if (c.isVoided) continue;
    feedExpenseByBatch.set(
      c.batchId,
      (feedExpenseByBatch.get(c.batchId) || 0) + c.totalCostNgn
    );
  }

  const otherExpenseByBatch = new Map<string, number>();
  const medicationExpenseByBatch = new Map<string, number>();
  for (const fp of params.farmPurchases || []) {
    if (fp.isVoided || !fp.batchId) continue;
    const isMedication = ['medication', 'vaccines_vet', 'supplements'].includes(fp.category);
    const target = isMedication ? medicationExpenseByBatch : otherExpenseByBatch;
    target.set(fp.batchId, (target.get(fp.batchId) || 0) + fp.totalCostNgn);
  }

  const result = new Map<string, BatchFinancialSummary>();
  for (const b of params.batches) {
    const eggsProduced = eggsByBatch.get(b.id) || 0;
    const directSalesRevenueNgn =
      Math.round((directSalesByBatch.get(b.id) || 0) * 100) / 100;
    const pooledSalesRevenueNgn =
      totalFarmEggs > 0 && pooledSalesNgn > 0
        ? Math.round(pooledSalesNgn * (eggsProduced / totalFarmEggs) * 100) / 100
        : 0;
    const totalRevenueNgn =
      Math.round((directSalesRevenueNgn + pooledSalesRevenueNgn) * 100) / 100;

    const feedExpenseNgn =
      Math.round((feedExpenseByBatch.get(b.id) || 0) * 100) / 100;
    const medicationExpenseNgn =
      Math.round((medicationExpenseByBatch.get(b.id) || 0) * 100) / 100;
    const directOtherExpenseNgn =
      Math.round((otherExpenseByBatch.get(b.id) || 0) * 100) / 100;
    const totalExpenseNgn =
      Math.round((feedExpenseNgn + medicationExpenseNgn + directOtherExpenseNgn) * 100) / 100;

    const netProfitNgn = Math.round((totalRevenueNgn - totalExpenseNgn) * 100) / 100;
    const profitMarginPct =
      totalRevenueNgn > 0
        ? Math.round((netProfitNgn / totalRevenueNgn) * 10000) / 100
        : 0;

    result.set(b.id, {
      batchId: b.id,
      eggsProduced,
      directSalesRevenueNgn,
      pooledSalesRevenueNgn,
      totalRevenueNgn,
      feedExpenseNgn,
      medicationExpenseNgn,
      directOtherExpenseNgn,
      totalExpenseNgn,
      netProfitNgn,
      profitMarginPct,
    });
  }
  return result;
}

export function convertFeedToGrams(
  quantity: number,
  unit: FeedUnit,
  bagWeightKg: number
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Feed quantity must be a finite number greater than zero.');
  }
  if (!Number.isFinite(bagWeightKg) || bagWeightKg <= 0) {
    throw new Error('Bag weight (kg) must be greater than zero.');
  }
  const grams = unit === 'kg' ? quantity * 1000 : quantity * bagWeightKg * 1000;
  return Math.round(grams * 1000) / 1000;
}

export function formatGramsToKgAndBags(
  grams: number,
  bagWeightKg: number = DEFAULT_BAG_WEIGHT_KG
): { kgText: string; bagsText: string } {
  const kg = grams / 1000;
  const bags = bagWeightKg > 0 ? kg / bagWeightKg : 0;
  return {
    kgText: `${kg.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`,
    bagsText: `${bags.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bags`,
  };
}

export interface CostSourceMatch {
  purchaseId: string;
  purchaseDate: string;
  unitCostPerGramNgn: number;
}

export function findQualifyingPurchaseForConsumption(
  purchases: FeedPurchase[],
  feedItemId: string,
  consumptionDate: string
): CostSourceMatch | null {
  const qualifying = purchases
    .filter(
      (p) =>
        !p.isVoided &&
        p.feedItemId === feedItemId &&
        p.transactionDate <= consumptionDate &&
        p.standardizedGrams > 0
    )
    .sort((a, b) => {
      if (a.transactionDate !== b.transactionDate) {
        return b.transactionDate.localeCompare(a.transactionDate);
      }
      const aSec =
        typeof (a.createdAt as { seconds?: number })?.seconds === 'number'
          ? (a.createdAt as { seconds: number }).seconds
          : 0;
      const bSec =
        typeof (b.createdAt as { seconds?: number })?.seconds === 'number'
          ? (b.createdAt as { seconds: number }).seconds
          : 0;
      if (aSec !== bSec) return bSec - aSec;
      return b.id.localeCompare(a.id);
    });

  if (qualifying.length === 0) return null;
  const latest = qualifying[0];
  return {
    purchaseId: latest.id,
    purchaseDate: latest.transactionDate,
    unitCostPerGramNgn: latest.unitCostPerGramNgn,
  };
}

export function computeConsumptionCostNgn(
  standardizedGrams: number,
  unitCostPerGramNgn: number
): number {
  if (!Number.isFinite(standardizedGrams) || standardizedGrams <= 0) {
    throw new Error('Standardized grams must be positive.');
  }
  if (!Number.isFinite(unitCostPerGramNgn) || unitCostPerGramNgn < 0) {
    throw new Error('Unit cost per gram cannot be negative.');
  }
  return Math.round(standardizedGrams * unitCostPerGramNgn * 100) / 100;
}

export function formatDateInTimezone(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}

export function addDaysToIsoDate(dateStr: string, deltaDays: number): string {
  const ms = parseIsoDateUtcMs(dateStr) + deltaDays * 86_400_000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatIsoDateDisplay(isoDate: string | Date | null | undefined): string {
  if (!isoDate) return '';
  if (isoDate instanceof Date) {
    if (isNaN(isoDate.getTime())) return '';
    const day = String(isoDate.getDate()).padStart(2, '0');
    const monthName = MONTH_SHORT_NAMES[isoDate.getMonth()] || '';
    const year = isoDate.getFullYear();
    return `${day} ${monthName}, ${year}`;
  }
  const str = String(isoDate).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, monthStr, day] = match;
    const monthIdx = Number(monthStr) - 1;
    const monthName = MONTH_SHORT_NAMES[monthIdx];
    if (monthName) {
      return `${day.padStart(2, '0')} ${monthName}, ${year}`;
    }
  }
  return str;
}

export function formatEggCountInCrates(eggs: number): string {
  const safeEggs = Math.max(0, Math.round(Number(eggs) || 0));
  const crates = Math.floor(safeEggs / EGGS_PER_CRATE);
  const pieces = safeEggs % EGGS_PER_CRATE;
  if (crates === 0 && pieces === 0) return '0 Crates';
  if (pieces === 0) return `${crates.toLocaleString()} Crate${crates === 1 ? '' : 's'}`;
  if (crates === 0) return `${pieces} pcs`;
  return `${crates.toLocaleString()} Crate${crates === 1 ? '' : 's'} + ${pieces} pcs`;
}

export function generateAutoBatchCode(
  penCodeOrName: string,
  placementDate: string,
  existingBatchCodes: string[] = []
): string {
  const cleanPen = penCodeOrName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleanPen || !/^\d{4}-\d{2}-\d{2}$/.test(placementDate)) {
    return '';
  }
  const yymmdd = `${placementDate.slice(2, 4)}${placementDate.slice(5, 7)}${placementDate.slice(8, 10)}`;
  const base = `${cleanPen}-${yymmdd}`;
  const usedKeys = new Set(existingBatchCodes.map((c) => toCodeKey(c)));
  if (!usedKeys.has(toCodeKey(base))) {
    return base;
  }
  let suffix = 2;
  while (usedKeys.has(toCodeKey(`${base}-${suffix}`))) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export const DATE_FILTER_PRESETS: { id: DateFilterPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This Week' },
  { id: 'last30Days', label: 'Last 30 Days' },
  { id: 'month', label: 'This Month' },
  { id: 'ytd', label: 'Year to Date' },
  { id: 'custom', label: 'Custom' },
];

export function resolveDateRange(
  preset: DateFilterPreset,
  timeZone: string = DEFAULT_TIMEZONE,
  customStart?: string,
  customEnd?: string,
  referenceNow: Date = new Date()
): { startDate: string; endDate: string } {
  const today = formatDateInTimezone(referenceNow, timeZone);

  if (preset === 'today') {
    return { startDate: today, endDate: today };
  }
  if (preset === 'yesterday') {
    const yest = addDaysToIsoDate(today, -1);
    return { startDate: yest, endDate: yest };
  }
  if (preset === 'week') {
    const dayOfWeek = new Date(parseIsoDateUtcMs(today)).getUTCDay(); // 0=Sun, 1=Mon
    const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    return { startDate: addDaysToIsoDate(today, offsetToMonday), endDate: today };
  }
  if (preset === 'last30Days') {
    return { startDate: addDaysToIsoDate(today, -29), endDate: today };
  }
  if (preset === 'month') {
    const startOfMonth = `${today.slice(0, 7)}-01`;
    return { startDate: startOfMonth, endDate: today };
  }
  if (preset === 'ytd') {
    const startOfYear = `${today.slice(0, 4)}-01-01`;
    return { startDate: startOfYear, endDate: today };
  }

  const startDate = customStart && /^\d{4}-\d{2}-\d{2}$/.test(customStart) ? customStart : today;
  const endDate = customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customEnd) ? customEnd : today;
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

export function formatNgn(amount: number): string {
  if (!Number.isFinite(amount)) return '₦0.00';
  return `₦${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function sanitizeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const escaped = raw.replace(/"/g, '""');
  // Prevent CSV spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${safe}"`;
}

export function downloadCsv(headers: string[], rows: unknown[][], filename: string): void {
  const lines = [
    headers.map(sanitizeCsvCell).join(','),
    ...rows.map((r) => r.map(sanitizeCsvCell).join(',')),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface DailyTrendPoint {
  date: string;
  shortDateLabel: string;
  displayDate: string;
  intactEggs: number;
  crackedOrDamagedEggs: number;
  totalEggs: number;
  eggEntryCount: number;
  feedGrams: number;
  feedKg: number;
  feedCostNgn: number;
  feedEntryCount: number;
  feedGramsPerEgg: number | null;
}

export function buildLast7DaysProductionAndFeedTrends(params: {
  todayDateStr: string;
  production: Pick<
    EggProductionEntry,
    'transactionDate' | 'batchId' | 'intactEggs' | 'crackedEggs' | 'damagedEggs' | 'totalEggs' | 'isVoided' | 'status'
  >[];
  consumptions: Pick<
    FeedConsumption,
    'transactionDate' | 'batchId' | 'standardizedGrams' | 'totalCostNgn' | 'isVoided'
  >[];
  batchId?: string;
}): DailyTrendPoint[] {
  const { todayDateStr, production, consumptions, batchId } = params;
  const scopedBatchId = batchId && batchId !== 'all' ? batchId : null;

  const points: DailyTrendPoint[] = [];
  const byDate = new Map<string, DailyTrendPoint>();

  for (let offset = -6; offset <= 0; offset += 1) {
    const date = addDaysToIsoDate(todayDateStr, offset);
    const [, monthStr, day] = date.split('-');
    const monthName = MONTH_SHORT_NAMES[Number(monthStr) - 1] || monthStr;
    const point: DailyTrendPoint = {
      date,
      shortDateLabel: `${day} ${monthName}`,
      displayDate: formatIsoDateDisplay(date),
      intactEggs: 0,
      crackedOrDamagedEggs: 0,
      totalEggs: 0,
      eggEntryCount: 0,
      feedGrams: 0,
      feedKg: 0,
      feedCostNgn: 0,
      feedEntryCount: 0,
      feedGramsPerEgg: null,
    };
    points.push(point);
    byDate.set(date, point);
  }

  for (const p of production) {
    if (p.isVoided || (p.status !== undefined && p.status !== 'APPROVED')) continue;
    if (scopedBatchId && p.batchId !== scopedBatchId) continue;
    const bucket = byDate.get(p.transactionDate);
    if (!bucket) continue;
    bucket.intactEggs += p.intactEggs;
    bucket.crackedOrDamagedEggs += p.crackedEggs + p.damagedEggs;
    bucket.totalEggs += p.totalEggs;
    bucket.eggEntryCount += 1;
  }

  for (const c of consumptions) {
    if (c.isVoided) continue;
    if (scopedBatchId && c.batchId !== scopedBatchId) continue;
    const bucket = byDate.get(c.transactionDate);
    if (!bucket) continue;
    bucket.feedGrams += c.standardizedGrams;
    bucket.feedCostNgn += c.totalCostNgn;
    bucket.feedEntryCount += 1;
  }

  for (const pt of points) {
    pt.feedKg = Math.round((pt.feedGrams / 1000) * 100) / 100;
    pt.feedCostNgn = Math.round(pt.feedCostNgn * 100) / 100;
    pt.feedGramsPerEgg =
      pt.totalEggs > 0 && pt.feedGrams > 0
        ? Math.round((pt.feedGrams / pt.totalEggs) * 10) / 10
        : null;
  }

  return points;
}

export interface StandardPoultryMilestone {
  milestoneKey: string;
  reminderType: ReminderType;
  targetAgeDays: number;
  title: string;
  dosageOrAction: string;
  notes: string;
  suggestedTreatmentType?: 'vaccination' | 'deworming' | 'vitamin';
}

export const STANDARD_POULTRY_MILESTONES: readonly StandardPoultryMilestone[] = [
  {
    milestoneKey: 'std_day_7',
    reminderType: 'vaccination',
    targetAgeDays: 7,
    title: 'Newcastle Disease (Lasota / B1) — 1st Dose',
    dosageOrAction: 'Eye drop or non-chlorinated drinking water',
    notes: 'Early Newcastle protection for chicks. Withdraw water sanitizers 24h prior.',
    suggestedTreatmentType: 'vaccination',
  },
  {
    milestoneKey: 'std_day_14',
    reminderType: 'vaccination',
    targetAgeDays: 14,
    title: 'Infectious Bursal Disease (Gumboro) — 1st Dose',
    dosageOrAction: 'Drinking water with skimmed milk stabilizer',
    notes: 'First IBD immunization; ensure drinkers are clean and cool.',
    suggestedTreatmentType: 'vaccination',
  },
  {
    milestoneKey: 'std_day_21',
    reminderType: 'vaccination',
    targetAgeDays: 21,
    title: 'Newcastle Disease (Lasota) — 2nd Dose / Booster',
    dosageOrAction: 'Drinking water (consume within 2 hours)',
    notes: 'Reinforces Newcastle immunity as maternal antibodies wane.',
    suggestedTreatmentType: 'vaccination',
  },
  {
    milestoneKey: 'std_day_28',
    reminderType: 'vaccination',
    targetAgeDays: 28,
    title: 'Infectious Bursal Disease (Gumboro) — Booster',
    dosageOrAction: 'Drinking water',
    notes: 'Second Gumboro dose for sustained bursal protection.',
    suggestedTreatmentType: 'vaccination',
  },
  {
    milestoneKey: 'std_day_42',
    reminderType: 'vaccination',
    targetAgeDays: 42,
    title: 'Fowl Pox Vaccine (6 Weeks)',
    dosageOrAction: 'Wing web stab applicator',
    notes: 'Check wing web 7–10 days later for successful vaccine take nodules.',
    suggestedTreatmentType: 'vaccination',
  },
  {
    milestoneKey: 'std_day_56',
    reminderType: 'vaccination',
    targetAgeDays: 56,
    title: 'Newcastle (Komarov) & Fowl Typhoid (8 Weeks)',
    dosageOrAction: '0.5ml IM / SC injection',
    notes: 'Grower immunization prior to mid-rearing transition.',
    suggestedTreatmentType: 'vaccination',
  },
  {
    milestoneKey: 'std_day_84',
    reminderType: 'medication',
    targetAgeDays: 84,
    title: '12-Week Grower Deworming & Vitamin Boost',
    dosageOrAction: 'Piperazine / Levamisole + Multivitamin',
    notes: 'Clear internal parasites and verify grower body weight uniformity.',
    suggestedTreatmentType: 'deworming',
  },
  {
    milestoneKey: 'std_day_112',
    reminderType: 'vaccination',
    targetAgeDays: 112,
    title: '16-Week Point-of-Lay Transfer & Combo Booster (ND + IB + EDS)',
    dosageOrAction: '0.5ml IM pre-lay inactivated combo vaccine',
    notes: 'Move pullets to layer house/cages and immunize before first egg.',
    suggestedTreatmentType: 'vaccination',
  },
  {
    milestoneKey: 'std_day_126',
    reminderType: 'milestone',
    targetAgeDays: 126,
    title: '18-Week First Egg Drop & Layer Mash Transition',
    dosageOrAction: 'Transition feed to Layer Mash & inspect nest boxes',
    notes: 'Step up lighting program and increase dietary calcium for shell formation.',
  },
  {
    milestoneKey: 'std_day_140',
    reminderType: 'milestone',
    targetAgeDays: 140,
    title: '20-Week Peak Lay Ramp-Up & Weight Check',
    dosageOrAction: 'Verify 50%+ lay rate, feed intake & flock uniformity',
    notes: 'Sample pen weights and confirm egg grading & crate hygiene readiness.',
  },
  {
    milestoneKey: 'std_day_280',
    reminderType: 'medication',
    targetAgeDays: 280,
    title: '40-Week Mid-Lay Deworming & Shell Quality Review',
    dosageOrAction: 'Layer-safe dewormer + Calcium/Vit D3 tonic',
    notes: 'Mid-cycle parasite management and cracked-egg rate audit.',
    suggestedTreatmentType: 'deworming',
  },
  {
    milestoneKey: 'std_day_364',
    reminderType: 'milestone',
    targetAgeDays: 364,
    title: '52-Week Annual Flock Performance Review',
    dosageOrAction: 'Audit cumulative FCR, survival % & ND booster need',
    notes: 'Full 1-year layer house review per batch.',
  },
  {
    milestoneKey: 'std_day_504',
    reminderType: 'milestone',
    targetAgeDays: 504,
    title: '72-Week Late-Lay Culling & Replacement Planning',
    dosageOrAction: 'Evaluate net margin per bird & schedule replacement pullets',
    notes: 'Plan depopulation or spent-layer sales before margin turns negative.',
  },
];

export type ReminderUrgency =
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'upcoming'
  | 'completed'
  | 'dismissed';

export interface ResolvedReminderItem {
  key: string;
  source: 'standard' | 'custom';
  persistedId: string | null;
  farmId: string;
  batchId: string;
  batchCode: string;
  penId: string;
  penName: string;
  milestoneKey: string;
  reminderType: ReminderType;
  title: string;
  dueDate: string;
  targetAgeDays: number | null;
  currentBatchAgeDays: number | null;
  daysUntilDue: number;
  urgency: ReminderUrgency;
  dosageOrAction: string;
  notes: string;
  status: ReminderStatus;
  completedAtDate: string;
  completedByName: string;
  suggestedTreatmentType?: 'vaccination' | 'deworming' | 'vitamin';
}

function classifyPendingUrgency(daysUntilDue: number): ReminderUrgency {
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue === 0) return 'due_today';
  if (daysUntilDue <= 14) return 'due_soon';
  return 'upcoming';
}

function getBatchAgeOnDateSafe(batch: PoultryBatch, dateStr: string): number | null {
  try {
    if (dateStr >= batch.placementDate) {
      return calculateBirdAgeDays({
        hatchDate: batch.hatchDate,
        placementDate: batch.placementDate,
        ageAtPlacementDays: batch.ageAtPlacementDays,
        transactionDate: dateStr,
      });
    }
    const baseAgeAtPlacement =
      batch.hatchDate && batch.hatchDate.trim().length > 0
        ? diffDays(batch.hatchDate, batch.placementDate)
        : batch.ageAtPlacementDays;
    return baseAgeAtPlacement + diffDays(batch.placementDate, dateStr);
  } catch {
    return null;
  }
}

export function buildBatchRemindersTimeline(params: {
  todayDateStr: string;
  batches: PoultryBatch[];
  reminders: FarmReminder[];
  batchId?: string;
}): ResolvedReminderItem[] {
  const { todayDateStr, batches, reminders, batchId } = params;
  const scopedBatchId = batchId && batchId !== 'all' ? batchId : null;

  const batchById = new Map(batches.map((b) => [b.id, b]));
  const stdByKey = new Map(STANDARD_POULTRY_MILESTONES.map((m) => [m.milestoneKey, m]));
  const resolvedPersistedMilestoneKeys = new Set<string>();
  const items: ResolvedReminderItem[] = [];

  for (const r of reminders) {
    if (scopedBatchId && r.batchId !== scopedBatchId) continue;
    const batch = batchById.get(r.batchId);
    if (r.milestoneKey) {
      resolvedPersistedMilestoneKeys.add(`${r.batchId}::${r.milestoneKey}`);
    }
    const daysUntilDue = diffDays(todayDateStr, r.dueDate);
    const currentBatchAgeDays = batch ? getBatchAgeOnDateSafe(batch, todayDateStr) : null;
    const stdMeta = r.milestoneKey ? stdByKey.get(r.milestoneKey) : undefined;
    const urgency: ReminderUrgency =
      r.status === 'completed'
        ? 'completed'
        : r.status === 'dismissed'
        ? 'dismissed'
        : classifyPendingUrgency(daysUntilDue);

    items.push({
      key: r.id,
      source: r.milestoneKey ? 'standard' : 'custom',
      persistedId: r.id,
      farmId: r.farmId,
      batchId: r.batchId,
      batchCode: batch?.batchCode || r.batchCodeSnapshot,
      penId: batch?.penId || r.penId,
      penName: batch?.penNameSnapshot || r.penNameSnapshot,
      milestoneKey: r.milestoneKey,
      reminderType: r.reminderType,
      title: r.title,
      dueDate: r.dueDate,
      targetAgeDays: r.targetAgeDays,
      currentBatchAgeDays,
      daysUntilDue,
      urgency,
      dosageOrAction: r.dosageOrAction,
      notes: r.notes,
      status: r.status,
      completedAtDate: r.completedAtDate,
      completedByName: r.completedByName,
      suggestedTreatmentType: stdMeta?.suggestedTreatmentType,
    });
  }

  for (const batch of batches) {
    if (batch.status !== 'active') continue;
    if (scopedBatchId && batch.id !== scopedBatchId) continue;
    const currentAge = getBatchAgeOnDateSafe(batch, todayDateStr);
    if (currentAge === null) continue;

    for (const m of STANDARD_POULTRY_MILESTONES) {
      const compositeKey = `${batch.id}::${m.milestoneKey}`;
      if (resolvedPersistedMilestoneKeys.has(compositeKey)) continue;

      const daysUntilDue = m.targetAgeDays - currentAge;
      const dueDate = addDaysToIsoDate(todayDateStr, daysUntilDue);

      // Ignore milestones that occurred before this batch was placed in the pen
      if (dueDate < batch.placementDate) continue;

      items.push({
        key: compositeKey,
        source: 'standard',
        persistedId: null,
        farmId: batch.farmId,
        batchId: batch.id,
        batchCode: batch.batchCode,
        penId: batch.penId,
        penName: batch.penNameSnapshot,
        milestoneKey: m.milestoneKey,
        reminderType: m.reminderType,
        title: m.title,
        dueDate,
        targetAgeDays: m.targetAgeDays,
        currentBatchAgeDays: currentAge,
        daysUntilDue,
        urgency: classifyPendingUrgency(daysUntilDue),
        dosageOrAction: m.dosageOrAction,
        notes: m.notes,
        status: 'pending',
        completedAtDate: '',
        completedByName: '',
        suggestedTreatmentType: m.suggestedTreatmentType,
      });
    }
  }

  return items.sort((a, b) => {
    const aPending = a.status === 'pending' ? 0 : 1;
    const bPending = b.status === 'pending' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    if (aPending === 0) {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.batchCode !== b.batchCode) return a.batchCode.localeCompare(b.batchCode);
      return a.title.localeCompare(b.title);
    }
    const aDone = a.completedAtDate || a.dueDate;
    const bDone = b.completedAtDate || b.dueDate;
    if (aDone !== bDone) return bDone.localeCompare(aDone);
    return a.title.localeCompare(b.title);
  });
}



export function hasDepartmentAccess(
  member: FarmMember | null | undefined,
  requiredDept: DepartmentType
): boolean {
  if (!member) return false;
  if (member.role === 'owner') return true;
  if (!member.departments || member.departments.length === 0) return true;
  return member.departments.includes(requiredDept) || member.departments.includes('general');
}

export function computeNextDueDate(
  currentDate: string,
  intervalUnit: RecurrenceUnit,
  intervalValue: number = 1
): string | null {
  if (intervalUnit === 'once') return null;
  const [y, m, d] = currentDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const safeInterval = Math.max(1, Math.round(intervalValue));

  if (intervalUnit === 'hour') {
    const daysToAdd = Math.max(1, Math.round(safeInterval / 24));
    date.setUTCDate(date.getUTCDate() + daysToAdd);
  } else if (intervalUnit === 'day') {
    date.setUTCDate(date.getUTCDate() + safeInterval);
  } else if (intervalUnit === 'week') {
    date.setUTCDate(date.getUTCDate() + safeInterval * 7);
  } else if (intervalUnit === 'month') {
    date.setUTCMonth(date.getUTCMonth() + safeInterval);
  }

  const nextY = date.getUTCFullYear();
  const nextM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextD = String(date.getUTCDate()).padStart(2, '0');
  return `${nextY}-${nextM}-${nextD}`;
}

export function computeDateWithOffset(baseDate: string, offsetDays: number): string {
  const [y, m, d] = baseDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const nextY = date.getUTCFullYear();
  const nextM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextD = String(date.getUTCDate()).padStart(2, '0');
  return `${nextY}-${nextM}-${nextD}`;
}
