export const DEFAULT_EGG_GRADES = ['Jumbo', 'Big', 'Medium', 'Small', 'Pullet', 'Unsorted'] as const;
export type EggGrade = (typeof DEFAULT_EGG_GRADES)[number];
export type EggStockCategory = EggGrade | 'Cracked' | 'Damaged';
export type EggSalesMode = 'phantom' | 'true_inventory';
export type EggInventoryOrganization = 'pen_based' | 'mixed';
export type EggGradingMode = 'graded' | 'unsorted';
export type EggTransferStatus = 'awaiting_receipt' | 'received' | 'voided';
export type EggMovementType =
  | 'opening_stock'
  | 'store_receipt'
  | 'sorting_in'
  | 'sorting_out'
  | 'sale'
  | 'free_distribution'
  | 'breakage'
  | 'adjustment'
  | 'disposal'
  | 'reversal';

export interface EggStoreSettings {
  id: 'current';
  farmId: string;
  salesMode: EggSalesMode;
  inventoryOrganization: EggInventoryOrganization;
  gradingMode: EggGradingMode;
  grades: EggGrade[];
  allowCrackedSales: boolean;
  allowDamagedSales: boolean;
  openingStockCompleted: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/** Canonical egg counts are integer pieces; UI crates are converted with 30 eggs per crate. */
export interface EggQuantities {
  intactEggs: number;
  crackedEggs: number;
  damagedEggs: number;
}

export interface EggProductionTransferBalance {
  id: string;
  farmId: string;
  productionEntryId: string;
  remainingIntactEggs: number;
  remainingCrackedEggs: number;
  remainingDamagedEggs: number;
  lastTransferId: string;
  updatedBy: string;
  updatedAt: unknown;
}

export interface EggTransfer {
  id: string;
  farmId: string;
  productionEntryId: string;
  productionDate: string;
  batchId: string;
  batchCodeSnapshot: string;
  penId: string;
  penNameSnapshot: string;
  quantities: EggQuantities;
  totalEggs: number;
  reference: string;
  remarks: string;
  status: EggTransferStatus;
  transferredBy: string;
  transferredByName: string;
  receivedBy: string;
  receivedByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface EggStoreReceipt {
  id: string;
  farmId: string;
  transferId: string;
  productionEntryId: string;
  batchId: string;
  batchCodeSnapshot: string;
  penId: string;
  penNameSnapshot: string;
  expected: EggQuantities;
  received: EggQuantities;
  expectedTotalEggs: number;
  receivedTotalEggs: number;
  varianceEggs: number;
  remarks: string;
  receivedBy: string;
  receivedByName: string;
  receivedAt: unknown;
  transactionDate: string;
  transactionTime: string;
}

export interface EggSortingBatch {
  id: string;
  farmId: string;
  receiptId: string;
  sourcePenId: string;
  sourcePenNameSnapshot: string;
  inputs: EggQuantities;
  gradeTotals: Record<EggGrade, number>;
  crackedEggs: number;
  damagedEggs: number;
  inputTotalEggs: number;
  outputTotalEggs: number;
  transactionDate: string;
  transactionTime: string;
  remarks: string;
  sortedBy: string;
  sortedByName: string;
  createdAt: unknown;
}

export interface EggInventoryMovement {
  id: string;
  farmId: string;
  movementType: EggMovementType;
  category: EggStockCategory;
  balanceId: string;
  quantityDelta: number;
  sourcePenId: string;
  sourcePenNameSnapshot: string;
  lotId: string;
  productionEntryId: string;
  transferId: string;
  receiptId: string;
  sortingBatchId: string;
  invoiceId: string;
  invoiceLineId: string;
  reference: string;
  transactionDate: string;
  reason: string;
  remarks: string;
  actorUid: string;
  actorName: string;
  createdAt: unknown;
}

export interface EggInventoryBalance {
  id: string;
  farmId: string;
  category: EggStockCategory;
  sourcePenId: string;
  sourcePenNameSnapshot: string;
  lotId: string;
  balanceEggs: number;
  lastMovementId: string;
  updatedAt: unknown;
}

export interface EggOpeningStockLine {
  category: EggStockCategory;
  sourcePenId: string;
  quantityEggs: number;
}
