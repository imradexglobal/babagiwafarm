export type SectorType = 'poultry';

export type MemberRole = 'owner' | 'staff';
export type MemberStatus = 'active' | 'inactive';

export interface CrudPermission {
  read: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
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

export interface PermissionsMatrix {
  batches: CrudPermission;
  production: CrudPermission;
  feed: CrudPermission;
  sales: SalesPermission;
  reports: ReportsPermission;
  settings: SettingsPermission;
  members: MembersPermission;
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

export type DateFilterPreset =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'last30Days'
  | 'month'
  | 'ytd'
  | 'custom';
