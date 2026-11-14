import type {
  DateFilterPreset,
  FarmMember,
  FeedPurchase,
  FeedUnit,
  PermissionsMatrix,
} from '../types/farm.ts';

export const EGGS_PER_CRATE = 30;
export const DEFAULT_BAG_WEIGHT_KG = 25;
export const DEFAULT_TIMEZONE = 'Africa/Lagos';

export const OWNER_FULL_PERMISSIONS: PermissionsMatrix = {
  batches: { read: true, create: true, edit: true, delete: true },
  production: { read: true, create: true, edit: true, delete: true },
  feed: { read: true, create: true, edit: true, delete: true },
  sales: { read: true, create: true, edit: true, delete: true, overridePrice: true },
  reports: { read: true, export: true },
  settings: { read: true, edit: true },
  members: { read: true, manage: true },
};

export const DEFAULT_STAFF_PERMISSIONS: PermissionsMatrix = {
  batches: { read: true, create: false, edit: false, delete: false },
  production: { read: true, create: true, edit: false, delete: false },
  feed: { read: true, create: true, edit: false, delete: false },
  sales: { read: true, create: true, edit: false, delete: false, overridePrice: false },
  reports: { read: true, export: false },
  settings: { read: false, edit: false },
  members: { read: false, manage: false },
};

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
