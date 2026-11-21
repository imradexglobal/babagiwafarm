import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { STANDARD_POULTRY_MILESTONES, generateId } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { CareCategory, CareInformation, CarePlan, CarePlanItem, ReminderType } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';
import { getPoultryCareTemplate, matchTemplateImportEntries, normalizeCareActivityIdentity, type PoultryCareTemplateId } from '../domain/careTemplates.ts';

const LIBRARY = 'careInformation';
const slug = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 96);

export interface CareInformationDraft {
  title: string;
  category: CareCategory;
  reminderType: ReminderType;
  animalApplicability: 'specific' | 'all';
  animalTypes: string[];
  productionTypes: string[];
  productionStages: string[];
  instructions: string;
  notes: string;
  autoIncludeGeneral: boolean;
  requiresVeterinaryApproval: boolean;
  requiresApproval: boolean;
  defaultOffsetDays: number;
  defaultIntervalUnit: CarePlanItem['intervalUnit'];
  defaultIntervalValue: number;
}

interface StarterEntry extends CareInformationDraft {}

const STARTER_REFERENCES: StarterEntry[] = [
  { title: 'Vaccination programme review with veterinarian', category: 'vaccination', reminderType: 'vaccination', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Set vaccine product, timing, route and dose only with the farm veterinarian and local disease guidance.', notes: 'Reference activity only. Not a prescription or universal schedule.', autoIncludeGeneral: false, requiresVeterinaryApproval: true, requiresApproval: true, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'Newcastle disease vaccination review (poultry)', category: 'vaccination', reminderType: 'vaccination', animalApplicability: 'specific', animalTypes: ['Chicken'], productionTypes: [], productionStages: [], instructions: 'Veterinarian to select product, timing, route and dose for the flock and local conditions.', notes: 'Do not use as a fixed schedule without veterinary review.', autoIncludeGeneral: false, requiresVeterinaryApproval: true, requiresApproval: true, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'Infectious bursal disease vaccination review (poultry)', category: 'vaccination', reminderType: 'vaccination', animalApplicability: 'specific', animalTypes: ['Chicken'], productionTypes: [], productionStages: [], instructions: 'Veterinarian to determine whether vaccination is indicated and select product and schedule.', notes: 'Reference only; not universally appropriate.', autoIncludeGeneral: false, requiresVeterinaryApproval: true, requiresApproval: true, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'PPR vaccination review (small ruminants)', category: 'vaccination', reminderType: 'vaccination', animalApplicability: 'specific', animalTypes: ['Goat', 'Sheep'], productionTypes: [], productionStages: [], instructions: 'Confirm local disease risk, product and timing with a veterinarian.', notes: 'Reference only; not an active livestock schedule.', autoIncludeGeneral: false, requiresVeterinaryApproval: true, requiresApproval: true, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'Clostridial vaccination review (ruminants)', category: 'vaccination', reminderType: 'vaccination', animalApplicability: 'specific', animalTypes: ['Cattle', 'Goat', 'Sheep'], productionTypes: [], productionStages: [], instructions: 'Veterinarian to assess need, product, timing and booster interval.', notes: 'Reference only; not an active livestock schedule.', autoIncludeGeneral: false, requiresVeterinaryApproval: true, requiresApproval: true, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'Routine animal health observation', category: 'monitoring_production', reminderType: 'monitoring', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Observe appetite, water intake, activity, body condition and unusual signs; escalate concerns to a veterinarian.', notes: 'Observation is not diagnosis or treatment.', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'day', defaultIntervalValue: 1 },
  { title: 'Veterinary review of suspected illness', category: 'medication_health', reminderType: 'medication', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Record observed signs and seek a qualified veterinarian before any treatment.', notes: 'No antibiotic or medicine is prescribed by this reference.', autoIncludeGeneral: false, requiresVeterinaryApproval: true, requiresApproval: true, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'Review parasite-control plan with veterinarian', category: 'medication_health', reminderType: 'medication', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Use diagnosis, local guidance, product labeling and veterinary advice. Record withdrawal restrictions.', notes: 'Not a deworming prescription.', autoIncludeGeneral: false, requiresVeterinaryApproval: true, requiresApproval: true, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'Inspect and clean drinkers', category: 'water_management', reminderType: 'water_management', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Remove visible soil and verify drinkers function and are accessible.', notes: 'Use a species-appropriate cleaning method.', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'day', defaultIntervalValue: 1 },
  { title: 'Check water availability and cleanliness', category: 'water_management', reminderType: 'water_management', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Check supply, flow, cleanliness and leaks; record issues for follow-up.', notes: '', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'day', defaultIntervalValue: 1 },
  { title: 'Inspect feed storage and feeders', category: 'animal_management', reminderType: 'feeding', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Check feed condition, storage security and feeder function.', notes: 'Follow species- and life-stage-appropriate nutrition guidance.', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'day', defaultIntervalValue: 1 },
  { title: 'Check animal comfort and housing conditions', category: 'animal_management', reminderType: 'inspection', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Assess ventilation, temperature, space, bedding and access to feed and water for the species and life stage.', notes: '', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'day', defaultIntervalValue: 1 },
  { title: 'Inspect bedding or litter condition', category: 'cleaning_sanitation', reminderType: 'cleaning', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Remove wet/soiled material as appropriate and keep housing dry.', notes: 'Choose bedding management appropriate to the housing system.', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'week', defaultIntervalValue: 1 },
  { title: 'Clean and disinfect housing between groups', category: 'cleaning_sanitation', reminderType: 'cleaning', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Follow product labeling, safe handling, drying time and species re-entry requirements.', notes: '', autoIncludeGeneral: false, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'Sanitize shared equipment and tools', category: 'cleaning_sanitation', reminderType: 'cleaning', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Clean and sanitize shared tools using a suitable labeled method.', notes: '', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'week', defaultIntervalValue: 1 },
  { title: 'Inspect perimeter and pest-control measures', category: 'biosecurity', reminderType: 'biosecurity', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Check entry points, pests, wild-animal access and feed spills; record corrective work.', notes: '', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'week', defaultIntervalValue: 1 },
  { title: 'Review visitor and vehicle biosecurity log', category: 'biosecurity', reminderType: 'biosecurity', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Confirm visitor records and the farm entry hygiene process are being followed.', notes: '', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'week', defaultIntervalValue: 1 },
  { title: 'Inspect fences, gates and housing repairs', category: 'facility_maintenance', reminderType: 'maintenance', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Record defects and prioritize repairs that affect animal safety or biosecurity.', notes: '', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'week', defaultIntervalValue: 1 },
  { title: 'Test backup water and power systems', category: 'facility_maintenance', reminderType: 'maintenance', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Check backup systems and document faults.', notes: '', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'month', defaultIntervalValue: 1 },
  { title: 'Review daily production and mortality records', category: 'monitoring_production', reminderType: 'monitoring', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Review trends and investigate unusual changes with appropriate farm and veterinary support.', notes: 'Record observations; do not infer diagnosis from a single metric.', autoIncludeGeneral: true, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'day', defaultIntervalValue: 1 },
  { title: 'Assess body condition and growth against farm targets', category: 'monitoring_production', reminderType: 'monitoring', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Record a representative assessment using the farm’s species- and stage-specific method.', notes: '', autoIncludeGeneral: false, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'week', defaultIntervalValue: 1 },
  { title: 'Check egg handling and nest hygiene (poultry)', category: 'animal_management', reminderType: 'inspection', animalApplicability: 'specific', animalTypes: ['Chicken'], productionTypes: ['Layer'], productionStages: [], instructions: 'Check nest condition and clean egg-handling surfaces.', notes: '', autoIncludeGeneral: false, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'day', defaultIntervalValue: 1 },
  { title: 'Review withdrawal periods before product use', category: 'medication_health', reminderType: 'medication', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Record labeled meat/egg withdrawal restrictions and confirm them with the veterinarian.', notes: 'No product or dose is prescribed.', autoIncludeGeneral: false, requiresVeterinaryApproval: true, requiresApproval: true, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 },
  { title: 'Check isolation and sick-animal handling area', category: 'biosecurity', reminderType: 'biosecurity', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: 'Check that a suitable separation and cleaning process is available when directed by the farm veterinarian.', notes: '', autoIncludeGeneral: false, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'week', defaultIntervalValue: 1 },
];

export function subscribeCareInformation(farmId: string, onData: (records: CareInformation[]) => void, onError: (error: Error) => void) {
  const path = `farms/${farmId}/${LIBRARY}`;
  return onSnapshot(query(collection(db, 'farms', farmId, LIBRARY), orderBy('title', 'asc')),
    (snap) => onData(snap.docs.map((entry) => entry.data() as CareInformation)),
    (error) => { try { handleFirestoreError(error, OperationType.LIST, path); } catch (caught) { onError(caught as Error); } });
}

export async function saveCareInformation(params: {
  farmId: string; actorUid: string; actorName: string; existing?: CareInformation; id?: string; draft: CareInformationDraft;
}): Promise<string> {
  const title = params.draft.title.trim().slice(0, 140);
  if (!title) throw new Error('Activity name is required.');
  const animalTypes = [...new Set(params.draft.animalTypes.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
  const productionTypes = [...new Set(params.draft.productionTypes.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
  const productionStages = [...new Set(params.draft.productionStages.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
  if (params.draft.animalApplicability === 'specific' && animalTypes.length === 0) throw new Error('Add at least one compatible animal type, or choose ALL/GENERAL.');
  const id = params.existing?.id || params.id || generateId('careinfo');
  const ref = doc(db, 'farms', params.farmId, LIBRARY, id);
  const updates = {
    title,
    category: params.draft.category,
    reminderType: params.draft.reminderType,
    animalApplicability: params.draft.animalApplicability,
    animalTypes: params.draft.animalApplicability === 'all' ? [] : animalTypes,
    productionTypes,
    productionStages,
    instructions: params.draft.instructions.trim().slice(0, 500),
    notes: params.draft.notes.trim().slice(0, 500),
    autoIncludeGeneral: params.draft.animalApplicability === 'all' && params.draft.autoIncludeGeneral,
    requiresVeterinaryApproval: params.draft.requiresVeterinaryApproval,
    requiresApproval: params.draft.requiresApproval || params.draft.requiresVeterinaryApproval,
    defaultOffsetDays: Math.max(0, Math.min(2000, Math.floor(params.draft.defaultOffsetDays || 0))),
    defaultIntervalUnit: params.draft.defaultIntervalUnit,
    defaultIntervalValue: Math.max(1, Math.min(3650, Math.floor(params.draft.defaultIntervalValue || 1))),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  if (params.existing) batch.update(ref, updates);
  else batch.set(ref, { ...updates, id, farmId: params.farmId, status: 'active', createdBy: params.actorUid, createdByName: params.actorName.slice(0, 150), createdAt: serverTimestamp() });
  const audit = buildAuditLogEntry({ farmId: params.farmId, entityType: 'careInformation', entityId: id, action: params.existing ? 'update' : 'create', summary: `${params.existing ? 'Updated' : 'Created'} care activity "${title}"`, before: params.existing ? { title: params.existing.title, category: params.existing.category } : {}, after: { title, category: params.draft.category, animalApplicability: params.draft.animalApplicability }, actorUid: params.actorUid, actorName: params.actorName });
  batch.set(audit.ref, audit.data);
  try { await batch.commit(); return id; } catch (error) { handleFirestoreError(error, params.existing ? OperationType.UPDATE : OperationType.CREATE, ref.path); }
}

export async function setCareInformationStatus(params: { farmId: string; record: CareInformation; status: 'active' | 'inactive'; actorUid: string; actorName: string }) {
  const ref = doc(db, 'farms', params.farmId, LIBRARY, params.record.id);
  const batch = writeBatch(db);
  const updates = { status: params.status, updatedBy: params.actorUid, updatedAt: serverTimestamp() };
  batch.update(ref, updates);
  const audit = buildAuditLogEntry({ farmId: params.farmId, entityType: 'careInformation', entityId: params.record.id, action: 'status_change', summary: `${params.status === 'active' ? 'Activated' : 'Deactivated'} care activity "${params.record.title}"`, before: { status: params.record.status }, after: updates, actorUid: params.actorUid, actorName: params.actorName });
  batch.set(audit.ref, audit.data);
  try { await batch.commit(); } catch (error) { handleFirestoreError(error, OperationType.UPDATE, ref.path); }
}

export async function seedStarterCareInformation(params: { farmId: string; actorUid: string; actorName: string }): Promise<number> {
  let created = 0;
  for (const draft of STARTER_REFERENCES) {
    const id = `starter_${slug(`${draft.category}_${draft.title}`)}`;
    const ref = doc(db, 'farms', params.farmId, LIBRARY, id);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    await saveCareInformation({ farmId: params.farmId, actorUid: params.actorUid, actorName: params.actorName, id, draft });
    created += 1;
  }
  return created;
}
export async function importLegacyPoultryDraft(params: { farmId: string; actorUid: string; actorName: string }): Promise<void> {
  const planId = 'legacy_poultry_schedule_review_v1';
  const planRef = doc(db, 'farms', params.farmId, 'carePlans', planId);
  if ((await getDoc(planRef)).exists()) throw new Error('The inactive legacy poultry draft has already been imported. It was not overwritten.');
  const batch = writeBatch(db);
  const plan: CarePlan = {
    id: planId, farmId: params.farmId, name: 'Legacy standard poultry milestones — review only',
    description: 'Inactive historical reference copied for farm/veterinary review. Not a recommendation, prescription, or approved universal schedule. Confirm applicability and all products, timing, route, dose, and withdrawal restrictions before any activation.',
    planType: 'activity', animalType: 'Chicken', productionType: 'Layer', schedulingReference: 'hatch',
    isLegacyDraft: true, status: 'inactive', createdBy: params.actorUid, createdByName: params.actorName.slice(0, 150),
    updatedBy: params.actorUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  batch.set(planRef, plan);
  STANDARD_POULTRY_MILESTONES.forEach((milestone, index) => {
    const id = `legacy_${milestone.milestoneKey}`;
    const item: CarePlanItem = {
      id, carePlanId: planId, farmId: params.farmId, title: milestone.title, reminderType: milestone.reminderType,
      category: milestone.reminderType === 'vaccination' ? 'vaccination' : milestone.reminderType === 'medication' ? 'medication_health' : 'monitoring_production',
      dosageOrAction: milestone.dosageOrAction, notes: `${milestone.notes} — legacy reference only; obtain veterinary review before use.`,
      offsetDays: milestone.targetAgeDays, intervalUnit: 'once', intervalValue: 1, sortOrder: index,
      careInformationId: '', requiresApproval: true, requiresVeterinaryApproval: true, scheduleMode: 'age', ageReference: 'hatch',
      createdBy: params.actorUid, createdByName: params.actorName.slice(0, 150), updatedBy: params.actorUid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    batch.set(doc(db, 'farms', params.farmId, 'carePlans', planId, 'items', id), item);
  });
  const audit = buildAuditLogEntry({ farmId: params.farmId, entityType: 'carePlan', entityId: planId, action: 'create', summary: 'Imported the legacy poultry milestone schedule as an inactive review-only draft', after: { name: plan.name, status: plan.status, itemCount: STANDARD_POULTRY_MILESTONES.length }, actorUid: params.actorUid, actorName: params.actorName });
  batch.set(audit.ref, audit.data);
  try { await batch.commit(); } catch (error) { handleFirestoreError(error, OperationType.CREATE, planRef.path); }
}

export interface ImportCareTemplateResult {
  planId: string;
  planCreated: boolean;
  tasksAdded: number;
  activitiesAdded: number;
  existingTasksPreserved: number;
}

/** Import a reusable poultry plan additively; existing plans, tasks, and activity edits are never overwritten. */
export async function importPoultryCareTemplate(params: {
  farmId: string;
  templateId: PoultryCareTemplateId;
  actorUid: string;
  actorName: string;
}): Promise<ImportCareTemplateResult> {
  const template = getPoultryCareTemplate(params.templateId);
  const planId = `care_template_${template.id}_v1`;
  const planRef = doc(db, 'farms', params.farmId, 'carePlans', planId);
  const [planSnapshot, activitySnapshot] = await Promise.all([
    getDoc(planRef),
    getDocs(collection(db, 'farms', params.farmId, LIBRARY)),
  ]);
  const planCreated = !planSnapshot.exists();
  const existingItemsSnapshot = planCreated
    ? null
    : await getDocs(collection(db, 'farms', params.farmId, 'carePlans', planId, 'items'));
  const existingItems = existingItemsSnapshot?.docs.map((entry) => ({ ref: entry.ref, value: entry.data() as CarePlanItem })) || [];
  const itemByIdentity = new Map(existingItems.map(({ value }) => [normalizeCareActivityIdentity(value.title, value.category || 'general'), value]));
  const activityByIdentity = new Map<string, CareInformation>();
  const activityIds = new Set(activitySnapshot.docs.map((entry) => entry.id));
  activitySnapshot.docs.forEach((entry) => {
    const activity = entry.data() as CareInformation;
    const key = normalizeCareActivityIdentity(activity.title, activity.category || 'general');
    if (!activityByIdentity.has(key)) activityByIdentity.set(key, activity);
  });
  const importMatches = matchTemplateImportEntries({
    tasks: template.tasks,
    existingTasks: existingItems.map(({ value }) => value),
    existingActivities: [...activityByIdentity.values()],
  });

  const batch = writeBatch(db);
  let activitiesAdded = 0;
  let tasksAdded = 0;
  let existingTasksPreserved = 0;
  let linksUpdated = false;

  for (const match of importMatches) {
    const { task, identity } = match;
    let activity = activityByIdentity.get(identity);
    if (!activity) {
      const activityId = `care_template_activity_${slug(`${task.category}_${task.title}`)}`;
      activity = {
        id: activityId,
        farmId: params.farmId,
        title: task.title,
        category: task.category,
        reminderType: task.reminderType,
        animalApplicability: 'specific',
        animalTypes: ['Chicken'],
        productionTypes: [],
        productionStages: [],
        instructions: task.dosageOrAction.slice(0, 500),
        notes: task.notes.slice(0, 500),
        autoIncludeGeneral: false,
        requiresVeterinaryApproval: Boolean(task.requiresVeterinaryApproval),
        requiresApproval: Boolean(task.requiresVeterinaryApproval),
        defaultOffsetDays: task.offsetDays,
        defaultIntervalUnit: task.intervalUnit,
        defaultIntervalValue: task.intervalValue,
        status: 'active',
        createdBy: params.actorUid,
        createdByName: params.actorName.slice(0, 150),
        updatedBy: params.actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      batch.set(doc(db, 'farms', params.farmId, LIBRARY, activityId), activity);
      activityByIdentity.set(identity, activity);
      activitiesAdded += 1;
    }
    const existingItem = itemByIdentity.get(identity);
    if (match.taskAlreadyExists && existingItem) {
      existingTasksPreserved += 1;
      if (!existingItem.careInformationId || !activityIds.has(existingItem.careInformationId)) {
        const existingRef = existingItems.find(({ value }) => value.id === existingItem.id)?.ref;
        if (existingRef) {
          batch.update(existingRef, { careInformationId: activity.id, updatedBy: params.actorUid, updatedAt: serverTimestamp() });
          linksUpdated = true;
        }
      }
      continue;
    }

    const itemId = `template_${slug(`${template.id}_${task.key}`)}`;
    const item: CarePlanItem = {
      id: itemId,
      carePlanId: planId,
      farmId: params.farmId,
      title: task.title.slice(0, 140),
      reminderType: task.reminderType,
      dosageOrAction: task.dosageOrAction.slice(0, 140),
      notes: task.notes.slice(0, 500),
      offsetDays: task.offsetDays,
      intervalUnit: task.intervalUnit,
      intervalValue: task.intervalValue,
      sortOrder: template.tasks.indexOf(task),
      careInformationId: activity.id,
      category: task.category,
      requiresApproval: Boolean(task.requiresVeterinaryApproval),
      requiresVeterinaryApproval: Boolean(task.requiresVeterinaryApproval),
      scheduleMode: 'age',
      ageReference: 'hatch',
      selectedWeekdays: [],
      endDate: '',
      endAgeDays: task.endAgeDays ?? null,
      occurrenceLimit: task.occurrenceLimit ?? null,
      eventTrigger: '',
      createdBy: params.actorUid,
      createdByName: params.actorName.slice(0, 150),
      updatedBy: params.actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(doc(db, 'farms', params.farmId, 'carePlans', planId, 'items', itemId), item);
    itemByIdentity.set(identity, item);
    tasksAdded += 1;
  }

  if (planCreated) {
    const plan: CarePlan = {
      id: planId,
      farmId: params.farmId,
      name: template.name,
      description: `${template.description} Reference schedule only; local veterinary/hatchery guidance and product labels take precedence. No medication doses are specified.`.slice(0, 300),
      planType: 'activity',
      animalType: 'Chicken',
      productionType: template.productionType,
      productionStage: template.productionStage,
      productionStages: template.productionStage ? [template.productionStage] : [],
      schedulingReference: 'hatch',
      status: 'active',
      isLegacyDraft: false,
      createdBy: params.actorUid,
      createdByName: params.actorName.slice(0, 150),
      updatedBy: params.actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(planRef, plan);
  }

  if (planCreated || tasksAdded > 0 || activitiesAdded > 0 || linksUpdated) {
    const audit = buildAuditLogEntry({
      farmId: params.farmId,
      entityType: 'carePlan',
      entityId: planId,
      action: planCreated ? 'create' : 'update',
      summary: `${planCreated ? 'Imported' : 'Merged'} the ${template.name} care template`,
      after: { templateId: template.id, planName: template.name, tasksAdded, activitiesAdded, existingTasksPreserved },
      actorUid: params.actorUid,
      actorName: params.actorName,
    });
    batch.set(audit.ref, audit.data);
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, planCreated ? OperationType.CREATE : OperationType.UPDATE, planRef.path);
    }
  }

  return { planId, planCreated, tasksAdded, activitiesAdded, existingTasksPreserved };
}
