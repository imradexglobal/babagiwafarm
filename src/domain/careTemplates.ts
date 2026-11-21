import type { CareCategory, RecurrenceUnit, ReminderType } from '../types/farm.ts';

export type PoultryCareTemplateId = 'layer_pullet_0_18' | 'layer_laying_18_plus' | 'broiler_0_8';

export interface PoultryCareTemplateTask {
  key: string;
  title: string;
  category: CareCategory;
  reminderType: ReminderType;
  offsetDays: number;
  dosageOrAction: string;
  notes: string;
  intervalUnit: RecurrenceUnit;
  intervalValue: number;
  occurrenceLimit?: number;
  endAgeDays?: number;
  conditional?: boolean;
  requiresVeterinaryApproval?: boolean;
}

export interface PoultryCareTemplate {
  id: PoultryCareTemplateId;
  name: string;
  description: string;
  productionType: 'Layer' | 'Broiler';
  productionStage: string;
  horizonDays: number;
  tasks: PoultryCareTemplateTask[];
}

const provenance = 'Source: user-provided poultry care-plan implementation brief (Nigeria/West Africa context). Confirm applicability, timing, product and route with the flock veterinarian/hatchery and product label.';
const vaccine = (key: string, title: string, offsetDays: number, action: string, notes: string, conditional = false): PoultryCareTemplateTask => ({
  key, title, offsetDays, category: 'vaccination', reminderType: 'vaccination', dosageOrAction: action,
  notes: `${notes} No dose is specified; follow product labeling. ${provenance}`,
  intervalUnit: 'once', intervalValue: 1, conditional, requiresVeterinaryApproval: true,
});
const review = (key: string, title: string, offsetDays: number, action: string, notes: string, intervalUnit: RecurrenceUnit = 'once', intervalValue = 1, occurrenceLimit?: number, endAgeDays?: number): PoultryCareTemplateTask => ({
  key, title, offsetDays, category: 'medication_health', reminderType: 'medication', dosageOrAction: action,
  notes: `${notes} Monitor first; use only when indicated and follow veterinary advice, product label and withdrawal period. ${provenance}`,
  intervalUnit, intervalValue, occurrenceLimit, endAgeDays, conditional: true, requiresVeterinaryApproval: true,
});
const activity = (task: Omit<PoultryCareTemplateTask, 'notes'> & { notes: string }): PoultryCareTemplateTask => ({ ...task, notes: `${task.notes} ${provenance}` });

export const POULTRY_CARE_TEMPLATES: readonly PoultryCareTemplate[] = [
  {
    id: 'layer_pullet_0_18',
    name: 'Layer 0–18 Weeks',
    description: 'Pullet rearing milestones, conditional parasite/coccidiosis options, routine monitoring and biosecurity through 18 weeks.',
    productionType: 'Layer', productionStage: 'Pullet', horizonDays: 126,
    tasks: [
      vaccine('marek_hatchery', "Marek's disease vaccine (HVT) — hatchery", 0, 'Live HVT (± SB-1/Rispens); subcutaneous injection at hatchery.', 'Day-old hatchery administration; maintain cold chain and confirm whether the hatchery already vaccinated.'),
      vaccine('nd_primary', 'Newcastle disease vaccine — primary', 3, 'Live Newcastle (B1/Lasota); eye-drop or drinking water as product directs.', 'Schedule around days 1–3. For water administration use clean, non-chlorinated water and follow label.'),
      vaccine('ibd_first', 'Gumboro (IBD) vaccine — first dose', 10, 'Live IBD intermediate strain; drinking water.', 'Around days 7–10; adjust to maternal antibody (MDA) status and hatchery/veterinary advice.'),
      vaccine('nd_booster_1', 'Newcastle disease vaccine — booster', 21, 'Live Newcastle (Lasota/B1/Clone 30); eye-drop or drinking water.', 'Booster timing is illustrative; follow the local flock plan and product instructions.'),
      vaccine('ibd_booster', 'Gumboro (IBD) vaccine — booster', 21, 'Live IBD vaccine; drinking water.', 'Illustrative day 18–24 window; coordinate with the first dose and MDA guidance.'),
      vaccine('fowl_pox', 'Fowl pox vaccine', 42, 'Live fowl-pox vaccine; wing-web stab or labeled route.', 'Around 6–8 weeks where locally indicated; check vaccine take as directed.'),
      vaccine('nd_rearing', 'Newcastle disease vaccine — rearing booster', 56, 'Live Newcastle (Lasota/Clone 30); drinking water or labeled route.', 'Around week 8; ensure birds are healthy and follow label and water-preparation instructions.'),
      vaccine('coryza_1', 'Infectious Coryza vaccine — dose 1 (optional)', 70, 'Inactivated bacterin; SC/IM as labeled.', 'Conditional on local disease risk; a second dose is only appropriate if advised by the veterinarian.' , true),
      vaccine('ib_optional', 'Infectious Bronchitis vaccine (optional)', 84, 'Live IB vaccine; spray or eye-drop as labeled.', 'Use only when local IB risk/strain guidance supports it; confirm product and route with a veterinarian.', true),
      vaccine('salmonella_optional', 'Salmonella (fowl typhoid) vaccine — conditional', 84, 'Product-specific live or killed Salmonella vaccine; route per label.', 'Optional, region-specific measure only; do not treat the attached farm-specific schedule as universal.', true),
      vaccine('coryza_2', 'Infectious Coryza vaccine — dose 2 (optional)', 98, 'Inactivated bacterin; SC/IM as labeled.', 'Only if dose 1 was given and the veterinarian recommends completing the series.', true),
      vaccine('nd_pretransfer', 'Newcastle disease vaccine — pre-transfer booster', 112, 'Live Newcastle (Lasota/B1); drinking water or labeled route.', 'Illustrative 14–16 week booster; confirm against the farm vaccination history.'),
      vaccine('nd_ib_eds_pre_lay', 'ND+IB+EDS inactivated vaccine — pre-lay', 119, 'Killed oil-emulsion multivalent vaccine; IM as labeled.', 'Typically around weeks 16–18. Confirm whether it is already included in the flock program; follow label and injection-site guidance.'),
      review('deworm_monitor', 'Deworming review (monitor first)', 56, 'Assess parasite signs/testing before considering an appropriate anthelmintic.', 'Conditional only; do not routinely medicate. Dose by weight if prescribed and record the withdrawal period.'),
      review('coccidiosis_choice', 'Coccidiosis control — choose vaccine or feed medication', 9, 'Choose one locally appropriate option: live coccidiosis vaccine OR labeled anticoccidial feed program.', 'Do not use live coccidiosis vaccine and chemical anticoccidial control together. Coordinate with hatchery/batch history and observe feed/product restrictions.'),
      activity({ key: 'pullet_weights', title: 'Record representative flock weights', category: 'monitoring_production', reminderType: 'monitoring', offsetDays: 7, dosageOrAction: 'Weigh a representative sample and compare with farm targets.', intervalUnit: 'week', intervalValue: 1, occurrenceLimit: 18, endAgeDays: 126, notes: 'Record a representative sample weekly; investigate trends with nutrition and veterinary support.' }),
      activity({ key: 'daily_flock_check', title: 'Daily mortality and flock health check', category: 'monitoring_production', reminderType: 'monitoring', offsetDays: 0, dosageOrAction: 'Record mortality and observe flock health, feed and water intake.', intervalUnit: 'day', intervalValue: 1, occurrenceLimit: 127, endAgeDays: 126, notes: 'Record daily mortality and unusual signs. Escalate concerns; observation is not diagnosis or treatment.' }),
      activity({ key: 'pullet_biosecurity', title: 'Weekly biosecurity and litter checks', category: 'biosecurity', reminderType: 'biosecurity', offsetDays: 0, dosageOrAction: 'Check entry controls/footbaths, litter, feeders and drinkers; record corrective action.', intervalUnit: 'week', intervalValue: 1, occurrenceLimit: 19, endAgeDays: 126, notes: 'Maintain access control, hygiene and appropriate litter management; follow safe product instructions.' }),
    ],
  },
  {
    id: 'layer_laying_18_plus',
    name: 'Layer 18+ (Laying Phase)',
    description: 'Point-of-lay preparation, risk-based vaccination/parasite measures, and recurring production, monitoring and biosecurity checks.',
    productionType: 'Layer', productionStage: 'Laying', horizonDays: 365,
    tasks: [
      activity({ key: 'housing_transfer', title: 'Housing and transfer preparation', category: 'animal_management', reminderType: 'animal_management', offsetDays: 126, dosageOrAction: 'Prepare the laying house and check flock health and target bodyweight.', intervalUnit: 'once', intervalValue: 1, notes: 'At approximately 18 weeks; stabilize housing and verify feeder/drinker setup before transfer.' }),
      vaccine('nd_ib_eds_check', 'ND+IB+EDS inactivated vaccine — point-of-lay check', 126, 'Killed oil-emulsion multivalent vaccine; IM as labeled if not already administered.', 'At point of lay only if absent from the pre-lay flock record; do not duplicate a completed dose.'),
      vaccine('eds_separate', 'Egg Drop Syndrome vaccine — separate dose if indicated', 126, 'Inactivated EDS vaccine; IM as labeled.', 'Often included in the ND+IB+EDS multivalent. Use a separate dose only when the veterinarian confirms it is not already covered.', true),
      vaccine('ib_lay_booster', 'Infectious Bronchitis vaccine booster (conditional)', 140, 'Live IB vaccine; drinking water or spray as labeled.', 'Only if local IB risk and strain guidance warrant a booster; veterinarian to select the product.', true),
      vaccine('salmonella_lay', 'Salmonella (fowl typhoid) vaccine booster (conditional)', 182, 'Product-specific Salmonella vaccine; route per label.', 'Regional/risk-based only; not a universal layer schedule. Observe egg/meat withdrawal requirements.', true),
      vaccine('coryza_lay', 'Infectious Coryza vaccine — annual booster (conditional)', 224, 'Inactivated bacterin; SC/IM as labeled.', 'Only for endemic/local risk and after veterinary review of the primary series.', true),
      review('deworm_lay', 'Deworming review (monitor first)', 182, 'Review parasite signs or test results before any treatment.', 'Not an automatic medication course. If treatment is indicated, use veterinarian/product-label directions and observe withdrawal.', 'week', 10, 6, 490),
      review('coccidiosis_lay', 'Coccidiosis control — choose vaccine or feed medication', 126, 'For floor systems, choose one locally appropriate option: vaccine OR labeled anticoccidial feed program.', 'Conditional on housing system and flock history. Do not use live vaccine and chemical anticoccidial control together.' , 'month', 1, 12, 490),
      activity({ key: 'layer_biosecurity', title: 'Layer house biosecurity and husbandry check', category: 'biosecurity', reminderType: 'biosecurity', offsetDays: 126, dosageOrAction: 'Check footbaths/access, litter, pest control, water quality and housing.', intervalUnit: 'week', intervalValue: 4, occurrenceLimit: 13, endAgeDays: 490, notes: 'Repeat approximately every 4 weeks; adjust to housing and local risk.' }),
      activity({ key: 'layer_production', title: 'Record layer weights and egg production', category: 'monitoring_production', reminderType: 'monitoring', offsetDays: 126, dosageOrAction: 'Record representative weights, egg count and feed/performance measures.', intervalUnit: 'week', intervalValue: 1, occurrenceLimit: 52, endAgeDays: 490, notes: 'Compare trends with farm targets and investigate unexpected changes.' }),
      activity({ key: 'daily_flock_check', title: 'Daily mortality and flock health check', category: 'monitoring_production', reminderType: 'monitoring', offsetDays: 126, dosageOrAction: 'Record mortality and observe flock health, feed and water intake.', intervalUnit: 'day', intervalValue: 1, occurrenceLimit: 365, endAgeDays: 490, notes: 'Record daily mortality and unusual signs. Escalate concerns; observation is not diagnosis or treatment.' }),
    ],
  },
  {
    id: 'broiler_0_8',
    name: 'Broiler 0–8 Weeks',
    description: 'Broiler vaccination milestones, conditional health measures, and recurring growth, mortality and biosecurity checks through 8 weeks.',
    productionType: 'Broiler', productionStage: '', horizonDays: 56,
    tasks: [
      vaccine('marek_hatchery', "Marek's disease vaccine (HVT) — hatchery", 0, 'Live HVT (± SB-1/Rispens); subcutaneous injection at hatchery.', 'Day-old hatchery administration; maintain cold chain and confirm whether the hatchery already vaccinated.'),
      vaccine('nd_primary', 'Newcastle disease vaccine — primary', 3, 'Live Newcastle (B1/Lasota); eye-drop or drinking water as product directs.', 'Schedule around days 1–3. For water administration use clean, non-chlorinated water and follow label.'),
      vaccine('ibd_first', 'Gumboro (IBD) vaccine — first dose', 10, 'Live IBD intermediate strain; drinking water.', 'Around days 7–10; adjust to maternal antibody (MDA) status and hatchery/veterinary advice.'),
      vaccine('nd_booster_1', 'Newcastle disease vaccine — booster', 21, 'Live Newcastle (Lasota); drinking water or labeled route.', 'Illustrative booster timing; confirm with local hatchery/veterinary plan.'),
      vaccine('ibd_booster', 'Gumboro (IBD) vaccine — booster', 28, 'Live IBD vaccine; drinking water.', 'Around week 3–4; coordinate with first dose, MDA status and product instructions.'),
      vaccine('nd_booster_2', 'Newcastle disease vaccine — grow-out booster', 28, 'Live Newcastle (Lasota/Komorov); water or spray as labeled.', 'Use only as specified by the local flock plan; avoid unintended duplicate dosing.'),
      vaccine('nd_late', 'Newcastle disease vaccine — late grow-out booster', 42, 'Live Newcastle vaccine; route per product label.', 'Optional timing within the 6–8 week range; check market age and veterinary plan.'),
      vaccine('fowl_cholera_optional', 'Fowl Cholera vaccine (conditional)', 42, 'Killed fowl-cholera vaccine; SC as labeled.', 'Only where local outbreaks/risk and a veterinarian support its use.', true),
      review('deworm_monitor', 'Deworming review (monitor first)', 21, 'Assess parasite signs/testing before considering an appropriate anthelmintic.', 'Conditional only; do not routinely medicate. Dose by weight if prescribed and record the withdrawal period.'),
      review('coccidiosis_choice', 'Coccidiosis control — choose vaccine or feed medication', 9, 'Choose one locally appropriate option: live coccidiosis vaccine OR labeled anticoccidial feed program.', 'Do not use live coccidiosis vaccine and chemical anticoccidial control together. Coordinate with hatchery/batch history and observe feed/product restrictions.'),
      activity({ key: 'broiler_weights', title: 'Record broiler weights and feed conversion', category: 'monitoring_production', reminderType: 'monitoring', offsetDays: 7, dosageOrAction: 'Weigh a representative sample and record feed conversion/performance.', intervalUnit: 'week', intervalValue: 1, occurrenceLimit: 8, endAgeDays: 56, notes: 'Track weekly growth and performance; investigate flocks that lag farm targets.' }),
      activity({ key: 'daily_flock_check', title: 'Daily mortality and flock health check', category: 'monitoring_production', reminderType: 'monitoring', offsetDays: 0, dosageOrAction: 'Record mortality and observe flock health, feed and water intake.', intervalUnit: 'day', intervalValue: 1, occurrenceLimit: 56, endAgeDays: 56, notes: 'Record daily mortality and unusual signs. Escalate concerns; observation is not diagnosis or treatment.' }),
      activity({ key: 'broiler_biosecurity', title: 'Weekly biosecurity and litter checks', category: 'biosecurity', reminderType: 'biosecurity', offsetDays: 0, dosageOrAction: 'Check entry controls/footbaths, litter, feeders and drinkers; record corrective action.', intervalUnit: 'week', intervalValue: 1, occurrenceLimit: 8, endAgeDays: 56, notes: 'Clean and disinfect between flocks; maintain access control and appropriate litter management.' }),
    ],
  },
];

export function normalizeCareActivityIdentity(title: string, category: string): string {
  const normalizedTitle = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘'`]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return `${normalizedTitle}::${category.trim().toLocaleLowerCase()}`;
}

export interface TemplateImportMatch {
  task: PoultryCareTemplateTask;
  identity: string;
  taskAlreadyExists: boolean;
  existingActivity: { id: string; title: string; category: string } | null;
}

/** Pure merge plan shared by the Firestore importer and idempotence tests. */
export function matchTemplateImportEntries(params: {
  tasks: readonly PoultryCareTemplateTask[];
  existingTasks: readonly { title: string; category?: string }[];
  existingActivities: readonly { id: string; title: string; category: string }[];
}): TemplateImportMatch[] {
  const taskIdentities = new Set(params.existingTasks.map((item) => normalizeCareActivityIdentity(item.title, item.category || 'general')));
  const activityByIdentity = new Map<string, { id: string; title: string; category: string }>();
  params.existingActivities.forEach((activity) => {
    const identity = normalizeCareActivityIdentity(activity.title, activity.category || 'general');
    if (!activityByIdentity.has(identity)) activityByIdentity.set(identity, activity);
  });
  return params.tasks.map((task) => {
    const identity = normalizeCareActivityIdentity(task.title, task.category);
    return { task, identity, taskAlreadyExists: taskIdentities.has(identity), existingActivity: activityByIdentity.get(identity) || null };
  });
}

export function getPoultryCareTemplate(id: PoultryCareTemplateId): PoultryCareTemplate {
  const template = POULTRY_CARE_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown poultry care template: ${id}`);
  return template;
}

export function previewTemplateDates(template: PoultryCareTemplate, referenceDate: string): Array<{ title: string; date: string; occurrenceCount: number }> {
  const base = new Date(`${referenceDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) throw new Error('Choose a valid planned hatch / day-old placement date.');
  return template.tasks.map((task) => {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() + task.offsetDays);
    return { title: task.title, date: date.toISOString().slice(0, 10), occurrenceCount: task.occurrenceLimit || 1 };
  });
}
