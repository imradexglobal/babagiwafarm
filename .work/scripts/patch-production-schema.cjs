const fs = require('fs');
const path = 'src/types/farm.ts';
let text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const marker = "export type FeedUnit = 'kg' | 'bags';";
const insert = `export type ProductionStatus = 'PENDING' | 'APPROVED' | 'VOIDED';

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

`;
const old = `export interface EggProductionEntry {
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
}`;
const newer = old.replace('  updatedAt: unknown;\n}', `  updatedAt: unknown;\n  parentId?: string;\n  status?: ProductionStatus;\n  approvedBy?: string;\n  approvedByName?: string;\n  approvedAt?: unknown;\n  approvalAuditId?: string;\n}`);
if (!text.includes(old)) throw new Error('EggProductionEntry block not found');
text = text.replace(old, newer).replace(marker, insert + marker);
fs.writeFileSync(path, text);
