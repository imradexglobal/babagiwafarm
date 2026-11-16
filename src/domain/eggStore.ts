import { EGGS_PER_CRATE } from './calculations.ts';
import type { EggGrade, EggQuantities, EggStockCategory } from '../types/eggStore.ts';

export { formatEggCountInCrates } from './calculations.ts';

export function eggsFromCratesAndPieces(crates: number, pieces: number): number {
  assertWholeNonNegative(crates, 'Crates');
  assertWholeNonNegative(pieces, 'Pieces');
  return crates * EGGS_PER_CRATE + pieces;
}

export function cratesAndPiecesFromEggs(eggs: number): { crates: number; pieces: number } {
  assertWholeNonNegative(eggs, 'Egg count');
  return { crates: Math.floor(eggs / EGGS_PER_CRATE), pieces: eggs % EGGS_PER_CRATE };
}

export function formatEggQuantity(eggs: number): string {
  const safeEggs = Math.max(0, Math.round(Number(eggs) || 0));
  const crates = Math.floor(safeEggs / EGGS_PER_CRATE);
  const pieces = safeEggs % EGGS_PER_CRATE;
  if (crates === 0 && pieces === 0) return '0 Crates';
  if (pieces === 0) return `${crates.toLocaleString()} Crate${crates === 1 ? '' : 's'}`;
  if (crates === 0) return `${pieces} pcs`;
  return `${crates.toLocaleString()} Crate${crates === 1 ? '' : 's'} + ${pieces} pcs`;
}

export function totalEggQuantities(q: EggQuantities): number {
  assertWholeNonNegative(q.intactEggs, 'Intact eggs');
  assertWholeNonNegative(q.crackedEggs, 'Cracked eggs');
  assertWholeNonNegative(q.damagedEggs, 'Damaged eggs');
  return q.intactEggs + q.crackedEggs + q.damagedEggs;
}

export function validateTransferQuantities(
  requested: EggQuantities,
  remaining: EggQuantities
): void {
  totalEggQuantities(requested);
  totalEggQuantities(remaining);
  if (totalEggQuantities(requested) <= 0) throw new Error('Transfer quantity must be greater than zero.');
  if (requested.intactEggs > remaining.intactEggs) throw new Error('Transfer exceeds untransferred intact egg production.');
  if (requested.crackedEggs > remaining.crackedEggs) throw new Error('Transfer exceeds untransferred cracked eggs.');
  if (requested.damagedEggs > remaining.damagedEggs) throw new Error('Transfer exceeds untransferred damaged eggs.');
}

export function transferStatus(remaining: EggQuantities, originalTotal: number): 'awaiting_transfer' | 'partially_transferred' | 'sent_to_store' {
  const remainingTotal = totalEggQuantities(remaining);
  if (remainingTotal === originalTotal) return 'awaiting_transfer';
  if (remainingTotal === 0) return 'sent_to_store';
  return 'partially_transferred';
}

export function validateSortingReconciliation(params: {
  inputs: EggQuantities;
  outputsByGrade: Partial<Record<EggGrade, number>>;
  crackedEggs: number;
  damagedEggs: number;
}): { inputTotalEggs: number; outputTotalEggs: number } {
  const inputTotalEggs = totalEggQuantities(params.inputs);
  assertWholeNonNegative(params.crackedEggs, 'Sorted cracked eggs');
  assertWholeNonNegative(params.damagedEggs, 'Sorted damaged eggs');
  let graded = 0;
  for (const [grade, count] of Object.entries(params.outputsByGrade)) {
    if (!count) continue;
    assertWholeNonNegative(count, `${grade} eggs`);
    graded += count;
  }
  const outputTotalEggs = graded + params.crackedEggs + params.damagedEggs;
  if (outputTotalEggs !== inputTotalEggs) {
    throw new Error(`Sorting must reconcile exactly: ${inputTotalEggs} eggs entered, ${outputTotalEggs} eggs assigned to grades/cracked/damaged.`);
  }
  if (graded + params.crackedEggs + params.damagedEggs === 0) {
    throw new Error('Sorting output must contain at least one egg.');
  }
  return { inputTotalEggs, outputTotalEggs };
}

export function validateInventoryDelta(currentEggs: number, deltaEggs: number, category: EggStockCategory): number {
  assertWholeNonNegative(currentEggs, 'Current stock');
  if (!Number.isInteger(deltaEggs)) throw new Error('Inventory movement must be a whole number of eggs.');
  const next = currentEggs + deltaEggs;
  if (next < 0) throw new Error(`Insufficient ${category} stock. Available: ${currentEggs} eggs.`);
  return next;
}

export function calculateInvoiceLineTotals(quantity: number, unitPriceNgn: number, discountNgn = 0): {
  grossNgn: number;
  totalNgn: number;
} {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than zero.');
  if (!Number.isFinite(unitPriceNgn) || unitPriceNgn < 0) throw new Error('Unit price must be zero or greater.');
  if (!Number.isFinite(discountNgn) || discountNgn < 0) throw new Error('Discount must be zero or greater.');
  const grossNgn = Math.round(quantity * unitPriceNgn * 100) / 100;
  if (discountNgn > grossNgn) throw new Error('Discount cannot exceed the line amount.');
  return { grossNgn, totalNgn: Math.round((grossNgn - discountNgn) * 100) / 100 };
}

export function calculatePaymentStatus(totalNgn: number, paidNgn: number): 'unpaid' | 'partial' | 'paid' {
  if (!Number.isFinite(totalNgn) || totalNgn < 0 || !Number.isFinite(paidNgn) || paidNgn < 0 || paidNgn > totalNgn) {
    throw new Error('Invalid invoice total or paid amount.');
  }
  if (paidNgn === 0) return 'unpaid';
  if (paidNgn >= totalNgn) return 'paid';
  return 'partial';
}

function assertWholeNonNegative(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative whole number.`);
}
