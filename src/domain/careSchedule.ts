import { computeDateWithOffset } from './calculations.ts';
import type { CareInformation, CarePlan, CarePlanItem, PoultryBatch } from '../types/farm.ts';

export interface CareClassification {
  animalType: string;
  productionType: string;
  productionStage: string;
  isLegacyInferred: boolean;
  needsReview: boolean;
}

export interface CareTarget {
  animalType: string;
  productionType: string;
  productionStage: string;
}

export interface CareScheduleCandidate {
  source: 'plan' | 'general';
  sourcePlanId: string;
  sourceItemId: string;
  careInformationId: string;
  title: string;
  reminderType: CareInformation['reminderType'] | CarePlanItem['reminderType'];
  category: CareInformation['category'];
  dosageOrAction: string;
  notes: string;
  offsetDays: number;
  intervalUnit: CarePlanItem['intervalUnit'];
  intervalValue: number;
  occurrenceLimit: number | null;
  endAgeDays: number | null;
  requiresApproval: boolean;
  requiresVeterinaryApproval: boolean;
  dueDate: string;
  exclusionReason?: string;
}

export interface CarePlanMatchResult {
  matchingPlans: CarePlan[];
  selectedPlan: CarePlan | null;
  candidates: CareScheduleCandidate[];
  excluded: CareScheduleCandidate[];
  missingClassification: string[];
}

const norm = (value: string | undefined | null) => (value || '').trim().toLocaleLowerCase();

/** Infer only the poultry mappings approved for legacy records; preserve ambiguous labels unchanged. */
export function resolveBatchCareClassification(batch: Pick<PoultryBatch, 'birdType'> & Partial<PoultryBatch>): CareClassification {
  if (batch.animalType?.trim()) {
    return {
      animalType: batch.animalType.trim(),
      productionType: batch.productionType?.trim() || '',
      productionStage: batch.productionStage?.trim() || '',
      isLegacyInferred: false,
      needsReview: !batch.productionType?.trim() && !batch.productionStage?.trim(),
    };
  }

  const label = norm(batch.birdType);
  const mapping: Record<string, { productionType?: string; productionStage?: string }> = {
    layer: { productionType: 'Layer' },
    broiler: { productionType: 'Broiler' },
    pullet: { productionType: 'Layer', productionStage: 'Pullet' },
    'point of lay': { productionType: 'Layer', productionStage: 'Point of Lay' },
    'parent stock / breeder': { productionType: 'Breeder' },
    'parent stock': { productionType: 'Breeder' },
    breeder: { productionType: 'Breeder' },
    'day-old chick': { productionStage: 'Day-Old Chick' },
  };
  const inferred = mapping[label];
  return {
    animalType: 'Chicken',
    productionType: inferred?.productionType || '',
    productionStage: inferred?.productionStage || '',
    isLegacyInferred: true,
    needsReview: !inferred || (!inferred.productionType && !inferred.productionStage),
  };
}

export function planMatchesTarget(plan: CarePlan, target: CareTarget): boolean {
  if (plan.status !== 'active' || plan.isLegacyDraft) return false;
  if (!plan.animalType || norm(plan.animalType) !== norm(target.animalType)) return false;
  if (!plan.productionType || norm(plan.productionType) !== norm(target.productionType)) return false;
  const stages = plan.productionStages || (plan.productionStage ? [plan.productionStage] : []);
  return stages.length === 0 || stages.some((stage) => norm(stage) === norm(target.productionStage));
}

function isInformationCompatible(info: CareInformation, target: CareTarget): boolean {
  if (info.status !== 'active') return false;
  if (info.animalApplicability !== 'all' && !info.animalTypes.some((animal) => norm(animal) === norm(target.animalType))) return false;
  if (info.productionTypes?.length && !info.productionTypes.some((type) => norm(type) === norm(target.productionType))) return false;
  if (info.productionStages?.length && !info.productionStages.some((stage) => norm(stage) === norm(target.productionStage))) return false;
  return true;
}

function candidateIdentity(item: Pick<CarePlanItem, 'id' | 'careInformationId' | 'title' | 'reminderType'> | Pick<CareInformation, 'id' | 'title' | 'reminderType'>): string {
  return 'careInformationId' in item && item.careInformationId
    ? `info:${item.careInformationId}`
    : `${norm(item.title)}::${item.reminderType}`;
}

function itemCandidate(item: CarePlanItem, dueDate: string): CareScheduleCandidate {
  return {
    source: 'plan',
    sourcePlanId: item.carePlanId,
    sourceItemId: item.id,
    careInformationId: item.careInformationId || '',
    title: item.title,
    reminderType: item.reminderType,
    category: item.category || (item.reminderType === 'vaccination' ? 'vaccination' : item.reminderType === 'medication' ? 'medication_health' : 'general'),
    dosageOrAction: item.dosageOrAction || '',
    notes: item.notes || '',
    offsetDays: item.offsetDays || 0,
    intervalUnit: item.intervalUnit || 'once',
    intervalValue: item.intervalValue || 1,
    occurrenceLimit: item.occurrenceLimit ?? null,
    endAgeDays: item.endAgeDays ?? null,
    requiresApproval: item.requiresApproval || false,
    requiresVeterinaryApproval: item.requiresVeterinaryApproval || false,
    dueDate,
  };
}

function informationCandidate(info: CareInformation, dueDate: string): CareScheduleCandidate {
  return {
    source: 'general',
    sourcePlanId: '',
    sourceItemId: '',
    careInformationId: info.id,
    title: info.title,
    reminderType: info.reminderType,
    category: info.category,
    dosageOrAction: info.instructions || '',
    notes: info.notes || '',
    offsetDays: info.defaultOffsetDays || 0,
    intervalUnit: info.defaultIntervalUnit || 'once',
    intervalValue: info.defaultIntervalValue || 1,
    occurrenceLimit: null,
    endAgeDays: null,
    requiresApproval: info.requiresApproval,
    requiresVeterinaryApproval: info.requiresVeterinaryApproval,
    dueDate,
  };
}

export function resolveCarePlanReferenceDate(batch: PoultryBatch, reference: CarePlanItem['ageReference']): string {
  if (reference === 'hatch' && batch.hatchDate) return batch.hatchDate;
  if (reference === 'hatch' && batch.ageAtPlacementDays > 0) return computeDateWithOffset(batch.placementDate, -batch.ageAtPlacementDays);
  return batch.placementDate;
}

/** Return exact matches and a reviewable schedule preview; ambiguous/unclassified plans never auto-match. */
export function buildCareScheduleMatch(params: {
  batch: PoultryBatch;
  plans: CarePlan[];
  planItemsByPlanId: Record<string, CarePlanItem[]>;
  careInformation: CareInformation[];
}): CarePlanMatchResult {
  const { batch, plans, planItemsByPlanId, careInformation } = params;
  const classification = resolveBatchCareClassification(batch);
  const target = {
    animalType: classification.animalType,
    productionType: classification.productionType,
    productionStage: classification.productionStage,
  };
  const matchingPlans = plans.filter((plan) => planMatchesTarget(plan, target));
  const selectedPlan = matchingPlans.length === 1 ? matchingPlans[0] : null;
  const candidates: CareScheduleCandidate[] = [];
  const excluded: CareScheduleCandidate[] = [];
  const seen = new Set<string>();

  if (selectedPlan) {
    for (const item of planItemsByPlanId[selectedPlan.id] || []) {
      const dueDate = computeDateWithOffset(resolveCarePlanReferenceDate(batch, item.ageReference || selectedPlan.schedulingReference), item.offsetDays || 0);
      const candidate = itemCandidate(item, dueDate);
      const linkedInformation = careInformation.find((info) => info.id === item.careInformationId);
      const identity = candidateIdentity(item);
      if (linkedInformation && !isInformationCompatible(linkedInformation, target)) {
        excluded.push({ ...candidate, exclusionReason: 'The linked care-information item is not compatible with this animal/production classification.' });
        continue;
      }
      seen.add(identity);
      candidates.push(candidate);
    }
  }

  for (const info of careInformation) {
    if (!info.autoIncludeGeneral || info.animalApplicability !== 'all') continue;
    const candidate = informationCandidate(info, computeDateWithOffset(batch.placementDate, info.defaultOffsetDays || 0));
    const identity = candidateIdentity(info);
    if (!isInformationCompatible(info, target)) {
      excluded.push({ ...candidate, exclusionReason: 'The general activity has a production/stage restriction that does not match this batch.' });
      continue;
    }
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push(candidate);
  }

  const missingClassification = [
    !target.animalType ? 'Animal Type' : '',
    !target.productionType ? 'Production Type' : '',
  ].filter(Boolean);
  return { matchingPlans, selectedPlan, candidates, excluded, missingClassification };
}

/** Stable, bounded Firestore document ID for an occurrence, suitable for retry-safe schedule generation. */
export function stableCareOccurrenceId(parts: { batchId: string; carePlanId?: string; activityId: string; dueDate: string; occurrenceIndex?: number }): string {
  const value = [parts.batchId, parts.carePlanId || '', parts.activityId, parts.dueDate, String(parts.occurrenceIndex || 0)].join('|');
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const hashes = seeds.map((seed) => {
    let hash = seed >>> 0;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  });
  return `care_${hashes.join('')}`;
}

export interface CareScheduleOccurrence extends CareScheduleCandidate {
  occurrenceIndex: number;
  parentDueDate: string;
}

function addScheduleInterval(dateString: string, unit: CarePlanItem['intervalUnit'], value: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (unit === 'hour') date.setUTCHours(date.getUTCHours() + value);
  else if (unit === 'day') date.setUTCDate(date.getUTCDate() + value);
  else if (unit === 'week') date.setUTCDate(date.getUTCDate() + value * 7);
  else if (unit === 'month') {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + value);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

/** Expand an item’s recurrence without allowing an unbounded series to flood the reminder collection. */
export function expandCareScheduleCandidate(candidate: CareScheduleCandidate, maxOccurrences = 500): CareScheduleOccurrence[] {
  const hardCap = Math.max(1, Math.min(500, Math.floor(maxOccurrences)));
  const interval = candidate.intervalUnit === 'once' ? 0 : Math.max(1, candidate.intervalValue || 1);
  const explicitLimit = candidate.occurrenceLimit == null ? null : Math.max(1, Math.floor(candidate.occurrenceLimit));
  const endDate = candidate.endAgeDays == null
    ? null
    : addScheduleInterval(candidate.dueDate, 'day', Math.max(0, candidate.endAgeDays - candidate.offsetDays));
  const cap = explicitLimit ?? (endDate ? hardCap : 1);
  const results: CareScheduleOccurrence[] = [];
  let dueDate = candidate.dueDate;
  for (let occurrenceIndex = 0; occurrenceIndex < cap; occurrenceIndex += 1) {
    if (explicitLimit != null && occurrenceIndex >= explicitLimit) break;
    if (endDate && dueDate > endDate) break;
    results.push({ ...candidate, dueDate, occurrenceIndex, parentDueDate: candidate.dueDate });
    if (!interval) break;
    dueDate = addScheduleInterval(candidate.dueDate, candidate.intervalUnit, interval * (occurrenceIndex + 1));
  }
  return results;
}
