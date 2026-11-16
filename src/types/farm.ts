export type SectorType = 'poultry';

export type DepartmentType = 'poultry' | 'fishery' | 'crops' | 'livestock' | 'general';

export type RecurrenceUnit = 'once' | 'hour' | 'day' | 'week' | 'month';

export type MemberRole = 'owner' | 'staff';
export type MemberStatus = 'active' | 'inactive';

export interface CrudPermission {
  read: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface ProductionPermission extends CrudPermission {
  approve: boolean;
}

export interface SalesPermission extends CrudPermission {
  overridePrice: boolean;
}

export interface ReportsPermission {
  read: boolean;
  export: boolean;
}

export interface SettingsPermission {
  read: boolean;
  edit: boolean;
}

export interface MembersPermission {
  read: boolean;
  manage: boolean;
}

export interface EggStorePermission {
  read: boolean;
  transfer: boolean;
  receive: boolean;
  sort: boolean;
  adjust: boolean;
  distribute: boolean;
  dispose: boolean;
}

export interface PermissionsMatrix {
  batches: CrudPermission;
  production: ProductionPermission;
  feed: CrudPermission;
  sales: SalesPermission;
  reports: ReportsPermission;
  settings: SettingsPermission;
  members: MembersPermission;
  eggStore: EggStorePermission;
}

export interface UserFarmBinding {
  uid: string;
  email: string;
  displayName: string;
  farmId: string;
  role: MemberRole;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PendingInvite {
  emailKey: string;
  farmId: string;
  farmName: string;
  inviteId: string;
  emailLower: string;
  jobTitle: string;
  role: 'staff';
  permissions: PermissionsMatrix;
  departments?: DepartmentType[];
  assignedPenIds?: string[];
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  acceptedByUid: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Farm {
  farmId: string;
  name: string;
  location: string;
  contactPhone: string;
  contactEmail: string;
  currency: string;
  timezone: string;
  activeSectors: SectorType[];
  ownerUid: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface FarmMember {
  uid: string;
  farmId: string;
  email: string;
  displayName: string;
  jobTitle: string;
  role: MemberRole;
  status: MemberStatus;
  permissions: PermissionsMatrix;
  departments?: DepartmentType[];     // which departments this member can access
  assignedPenIds?: string[];          // pens this member is assigned to monitor
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface FarmInvite {
  id: string;
  farmId: string;
  emailKey: string;
  emailLower: string;
  jobTitle: string;
  permissions: PermissionsMatrix;
  departments?: DepartmentType[];
  assignedPenIds?: string[];
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  acceptedByUid: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Pen {
  id: string;
  farmId: string;
  name: string;
  code: string;
  capacity: number;
  sector: 'poultry';
  activeBatchId: string;
  notes: string;
  department?: DepartmentType;        // which department this pen belongs to
  assignedMemberUids?: string[];      // staff UIDs assigned to this pen
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface FeedItem {
  id: string;
  farmId: string;
  feedType: string;
  brand: string;
  defaultBagWeightKg: number;
  notes: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface FeedStock {
  feedItemId: string;
  farmId: string;
  feedType: string;
  brand: string;
  balanceGrams: number;
  lastPurchaseDate: string;
  lastUnitCostPerGramNgn: number;
  updatedAt: unknown;
}

export interface SalesUnit {
  id: string;
  farmId: string;
  name: string;
  eggCountPerUnit: number;
  currentPriceNgn: number;
  effectiveDate: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PoultryBatch {
  id: string;
  farmId: string;
  batchCode: string;
  penId: string;
  penNameSnapshot: string;
  birdType: string;
  breed: string;
  strain?: string;
  source: string;
  hatchDate: string;
  ageAtPlacementDays: number;
  placementDate: string;
  initialCount: number;
  maleCount: number;
  femaleCount: number;
  remarks: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
  assignedCarePlanIds?: string[];   // care plan IDs assigned at batch creation
}

export interface EggProductionEntry {
  id: string;
  farmId: string;
  transactionDate: string;
  transactionTime: string;
  batchId: string;
  batchCodeSnapshot: string;
  penId: string;
  penNameSnapshot: string;
  birdAgeDaysAtTransaction: number;
  crates: number;
  pieces: number;
  intactEggs: number;
  crackedEggs: number;
  damagedEggs: number;
  totalEggs: number;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  voidedBy: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
  parentId?: string;
  status?: ProductionStatus;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: unknown;
  approvalAuditId?: string;
}

export type ProductionStatus = 'PENDING' | 'APPROVED' | 'VOIDED';

export interface ProductionRecord {
  id: string;
  farmId: string;
  batchId: string;
  batchCodeSnapshot: string;
  transactionDate: string;
  status: ProductionStatus;
  createdBy: string;
  createdByName: string;
  createdAt: unknown;
  updatedBy: string;
  updatedAt: unknown;
  approvedBy: string;
  approvedByName: string;
  approvedAt: unknown;
  approvalAuditId: string;
}

export type FeedUnit = 'kg' | 'bags';

export interface FeedPurchase {
  id: string;
  farmId: string;
  transactionDate: string;
  feedItemId: string;
  feedTypeSnapshot: string;
  brandSnapshot: string;
  enteredQuantity: number;
  enteredUnit: FeedUnit;
  bagWeightKgSnapshot: number;
  standardizedGrams: number;
  unitPurchasePriceNgn: number;
  totalCostNgn: number;
  unitCostPerGramNgn: number;
  supplier: string;
  reference: string;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  voidedBy: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface FeedConsumption {
  id: string;
  farmId: string;
  transactionDate: string;
  transactionTime: string;
  batchId: string;
  batchCodeSnapshot: string;
  penId: string;
  penNameSnapshot: string;
  feedItemId: string;
  feedTypeSnapshot: string;
  brandSnapshot: string;
  enteredQuantity: number;
  enteredUnit: FeedUnit;
  bagWeightKgSnapshot: number;
  standardizedGrams: number;
  costSourcePurchaseId: string;
  costSourcePurchaseDate: string;
  unitCostPerGramNgn: number;
  totalCostNgn: number;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  voidedBy: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type PaymentStatus = 'paid' | 'pending' | 'partial';

export interface EggSale {
  id: string;
  farmId: string;
  transactionDate: string;
  transactionTime: string;
  customerName: string;
  eggCategory: string;
  salesUnitId: string;
  unitNameSnapshot: string;
  eggsPerUnitSnapshot: number;
  quantity: number;
  totalEggsEquivalent: number;
  suggestedUnitPriceNgn: number;
  unitPriceNgn: number;
  priceOverridden: boolean;
  overrideReason: string;
  totalAmountNgn: number;
  paymentStatus: PaymentStatus;
  batchId?: string;
  batchCodeSnapshot?: string;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  voidedBy: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'void'
  | 'status_change'
  | 'price_override'
  | 'permission_change';

export interface AuditLog {
  id: string;
  farmId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actorUid: string;
  actorName: string;
  createdAt: unknown;
}

export type TimeOfDay = 'morning' | 'afternoon' | 'night';

export interface MortalityEntry {
  id: string;
  farmId: string;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  batchId: string;
  batchCodeSnapshot: string;
  penId: string;
  penNameSnapshot: string;
  birdAgeDaysAtTransaction: number;
  mortalityCount: number;
  reasonCategory: string;
  reasonDetail: string;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  voidedBy: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type MedicationTreatmentType =
  | 'medication'
  | 'vaccination'
  | 'vitamin'
  | 'deworming'
  | 'other';

export interface MedicationLog {
  id: string;
  farmId: string;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  transactionTime: string;
  batchId: string;
  batchCodeSnapshot: string;
  penId: string;
  penNameSnapshot: string;
  birdAgeDaysAtTransaction: number;
  medicationName: string;
  treatmentType: MedicationTreatmentType;
  dosage: string;
  administrationRoute: string;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  voidedBy: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface EnvironmentMetricLog {
  id: string;
  farmId: string;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  transactionTime: string;
  batchId: string;
  batchCodeSnapshot: string;
  penId: string;
  penNameSnapshot: string;
  birdAgeDaysAtTransaction: number;
  averageWeightGrams: number | null;
  sampleSize: number;
  temperatureC: number | null;
  humidityPct: number | null;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  voidedBy: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type PurchaseCategory =
  | 'medication'
  | 'vaccines_vet'
  | 'supplements'
  | 'chicks_stock'
  | 'litter_bedding'
  | 'packaging'
  | 'utilities_fuel'
  | 'equipment_repairs'
  | 'labor'
  | 'other';

export interface FarmPurchase {
  id: string;
  farmId: string;
  transactionDate: string;
  category: PurchaseCategory;
  itemName: string;
  quantity: number;
  unit: string;
  unitPriceNgn: number;
  totalCostNgn: number;
  supplier: string;
  reference: string;
  batchId: string;
  batchCodeSnapshot: string;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  voidedBy: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type DraftType = 'daily_production' | 'purchase';

export interface DailyProductionDraftPayload {
  transactionDate: string;
  timeOfDay: TimeOfDay;
  transactionTime: string;
  batchId: string;
  includeEgg: boolean;
  crates: string;
  pieces: string;
  crackedEggs: string;
  damagedEggs: string;
  eggRemarks: string;
  includeFeed: boolean;
  feedItemId: string;
  feedQuantity: string;
  feedUnit: FeedUnit;
  feedRemarks: string;
  includeMedication: boolean;
  medicationName: string;
  treatmentType: MedicationTreatmentType;
  dosage: string;
  administrationRoute: string;
  medicationRemarks: string;
  includeMortality: boolean;
  mortalityCount: string;
  reasonCategory: string;
  reasonDetail: string;
  mortalityRemarks: string;
  includeMetrics?: boolean;
  includeWeight?: boolean;
  averageWeightGrams: string;
  sampleSize: string;
  weightRemarks?: string;
  includeEnvironment?: boolean;
  temperatureC: string;
  humidityPct: string;
  environmentRemarks?: string;
  metricsRemarks?: string;
}

export interface PurchaseDraftPayload {
  kind: 'feed' | 'general';
  transactionDate: string;
  feedItemId: string;
  feedQty: string;
  feedUnit: FeedUnit;
  feedBagWeight: string;
  feedUnitPrice: string;
  category: PurchaseCategory;
  itemName: string;
  quantity: string;
  unit: string;
  unitPriceNgn: string;
  batchId: string;
  supplier: string;
  reference: string;
  remarks: string;
}

export interface RecordDraft {
  id: string;
  farmId: string;
  draftType: DraftType;
  title: string;
  transactionDate: string;
  batchId: string;
  payload: Record<string, unknown>;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type DateFilterPreset =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'last30Days'
  | 'month'
  | 'ytd'
  | 'custom';

export type ReminderType = 'vaccination' | 'medication' | 'milestone';
export type ReminderStatus = 'pending' | 'completed' | 'dismissed';

export interface FarmReminder {
  id: string;
  farmId: string;
  batchId: string;
  batchCodeSnapshot: string;
  penId: string;
  penNameSnapshot: string;
  milestoneKey: string;
  reminderType: ReminderType;
  title: string;
  dueDate: string;
  targetAgeDays: number | null;
  dosageOrAction: string;
  notes: string;
  status: ReminderStatus;
  completedAtDate: string;
  completedBy: string;
  completedByName: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
  // Care plan linkage
  carePlanId?: string;
  carePlanItemId?: string;
  // Recurrence
  intervalUnit?: RecurrenceUnit;
  intervalValue?: number;
  occurrenceIndex?: number;    // 0-based, which repetition this is
  parentReminderId?: string;   // id of the first occurrence in this series
}

export interface CarePlanItem {
  id: string;
  carePlanId: string;
  farmId: string;
  title: string;              // max 140 chars
  reminderType: ReminderType; // reuse existing type
  dosageOrAction: string;     // max 140 chars
  notes: string;              // max 500 chars
  // When to trigger relative to batch placement date
  offsetDays: number;         // days after placement date for first occurrence (0 = same day)
  // Recurrence
  intervalUnit: RecurrenceUnit;
  intervalValue: number;      // e.g. 2 for "every 2 days"; ignored when intervalUnit='once'
  sortOrder: number;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface CarePlan {
  id: string;
  farmId: string;
  name: string;               // max 100 chars
  description: string;        // max 300 chars
  planType: 'medication' | 'vaccination' | 'activity';
  status: 'active' | 'inactive';
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}
