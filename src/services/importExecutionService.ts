/**
 * Safe, transactional and batched execution service for importing validated records into Firestore.
 */

import {
  collection,
  doc,
  DocumentReference,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { calculateBirdAgeDays, generateId, toCodeKey } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { Farm, FarmMember, PoultryBatch } from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';
import { SCHEMA_VERSION } from './importExportSchema.ts';
import type { ValidationReport } from './importValidator.ts';

export interface ImportExecutionOptions {
  duplicateStrategy: 'skip' | 'update';
  /** Pre-loaded existing IDs for duplicate detection. Keys are collection names. */
  existingPenIds?: Set<string>;
  existingFeedItemIds?: Set<string>;
  existingSalesUnitIds?: Set<string>;
  existingBatchIds?: Set<string>;
  existingCustomerIds?: Set<string>;
  existingVendorIds?: Set<string>;
  onProgress?: (progress: { stage: string; current: number; total: number; percent: number }) => void;
}

export interface ImportExecutionResult {
  importId: string;
  success: boolean;
  recordsImported: number;
  recordsSkipped: number;
  recordsFailed: number;
  message: string;
  error?: string;
}

export interface ImportHistoryEntry {
  id: string;
  originalFileName: string;
  importDate: string;
  actorUid: string;
  actorName: string;
  farmId: string;
  recordsImported: number;
  recordsSkipped: number;
  recordsFailed: number;
  status: 'completed' | 'partial' | 'failed';
  schemaVersion: string;
  summary: string;
  createdAt: unknown;
}

/**
 * Execute the safe import in ordered stages using Firestore write batches.
 */
function safeCalculateBirdAge(batch: any, transactionDate: string): number {
  if (!batch || !batch.placementDate || !transactionDate) return 0;
  try {
    return calculateBirdAgeDays({
      hatchDate: batch.hatchDate || '',
      placementDate: batch.placementDate,
      ageAtPlacementDays: Number(batch.ageAtPlacementDays) || 0,
      transactionDate,
    });
  } catch {
    return 0;
  }
}

export async function executeSafeImport(
  report: ValidationReport,
  originalFileName: string,
  farm: Farm,
  member: FarmMember,
  existingBatches: PoultryBatch[],
  options: ImportExecutionOptions
): Promise<ImportExecutionResult> {
  const importId = generateId('imp');
  const nowIso = new Date().toISOString();
  let recordsImported = 0;
  let recordsSkipped = 0;
  let recordsFailed = 0;

  const data = report.parsedData;
  const duplicateStrategy = options.duplicateStrategy;

  // Build existing-ID sets for duplicate detection (skip strategy)
  const existingPenIds = options.existingPenIds ?? new Set<string>();
  const existingFeedItemIds = options.existingFeedItemIds ?? new Set<string>();
  const existingSalesUnitIds = options.existingSalesUnitIds ?? new Set<string>();
  const existingBatchIds = options.existingBatchIds ?? new Set<string>();
  const existingCustomerIds = options.existingCustomerIds ?? new Set<string>();
  const existingVendorIds = options.existingVendorIds ?? new Set<string>();

  // Build local lookup caches for foreign snapshot resolution
  const penNameMap = new Map<string, string>();
  const batchCodeMap = new Map<string, string>();
  const batchObjectMap = new Map<string, any>();
  const feedTypeMap = new Map<string, { type: string; brand: string; bagWeight: number }>();
  const salesUnitMap = new Map<string, { name: string; eggsPerUnit: number; price: number }>();

  // Prepopulate from existing batches
  for (const b of existingBatches) {
    batchCodeMap.set(b.id, b.batchCode);
    batchObjectMap.set(b.id, b);
    penNameMap.set(b.penId, b.penNameSnapshot);
  }

  // Populate from incoming pens
  for (const p of data['pens'] || []) {
    if (p.id) penNameMap.set(p.id, p.name || p.code || p.id);
  }

  // Populate from incoming feed items
  for (const f of data['feed_items'] || []) {
    if (f.id) {
      feedTypeMap.set(f.id, {
        type: f.feed_type || '',
        brand: f.brand || '',
        bagWeight: Number(f.default_bag_weight_kg) || 25,
      });
    }
  }

  // Populate from incoming sales units
  for (const su of data['sales_units'] || []) {
    if (su.id) {
      salesUnitMap.set(su.id, {
        name: su.name || '',
        eggsPerUnit: Number(su.egg_count_per_unit) || 30,
        price: Number(su.current_price_ngn) || 0,
      });
    }
  }

  // Populate from incoming batches
  for (const b of data['batches'] || []) {
    if (b.id) {
      batchCodeMap.set(b.id, (b.batch_code || '').trim().toUpperCase());
      batchObjectMap.set(b.id, {
        id: b.id,
        batchCode: (b.batch_code || '').trim().toUpperCase(),
        penId: b.pen_id,
        penNameSnapshot: penNameMap.get(b.pen_id) || '',
        hatchDate: b.hatch_date || '',
        placementDate: b.placement_date,
        ageAtPlacementDays: Number(b.age_at_placement_days) || 0,
      });
    }
  }

  /**
   * Helper to generate a stable parentId for a batch+date combination.
   * Mirrors productionService.ts: `prod_parent_${batchId}_${date}` with non-alphanum replaced by '_'
   */
  const parentIdFor = (batchId: string, date: string) =>
    `prod_parent_${batchId}_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  /**
   * Helper to generate a stable mortality parent ID for a batch+date.
   */
  const mortParentIdFor = (batchId: string, date: string) =>
    `mort_parent_${batchId}_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  /**
   * Two-stage operation lists.
   * foundational: pens, feedItems, salesUnits, customers, vendors, batches, batchCodes
   * transactional: everything else (must be committed AFTER foundational so exists() checks pass)
   */
  const foundationalOps: { ref: DocumentReference; data: any; merge?: boolean }[] = [];
  const transactionalOps: { ref: DocumentReference; data: any; merge?: boolean }[] = [];

  try {
    // 1. Stage Pens
    for (const p of data['pens'] || []) {
      const penId = String(p.id).trim();
      if (duplicateStrategy === 'skip' && existingPenIds.has(penId)) {
        recordsSkipped++;
        continue;
      }
      const ref = doc(db, 'farms', farm.farmId, 'pens', penId);
      foundationalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: penId,
          farmId: farm.farmId,
          name: p.name || 'Pen',
          code: (p.code || penId).trim().toUpperCase(),
          capacity: Number(p.capacity) || 1000,
          sector: 'poultry',
          department: p.department || 'poultry',
          activeBatchId: '',
          notes: p.notes || '',
          status: p.status || 'active',
          createdBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 2. Stage Feed Items
    for (const f of data['feed_items'] || []) {
      const feedItemId = String(f.id).trim();
      if (duplicateStrategy === 'skip' && existingFeedItemIds.has(feedItemId)) {
        recordsSkipped++;
        continue;
      }
      const ref = doc(db, 'farms', farm.farmId, 'feedItems', feedItemId);
      foundationalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: feedItemId,
          farmId: farm.farmId,
          feedType: f.feed_type || '',
          brand: f.brand || '',
          defaultBagWeightKg: Number(f.default_bag_weight_kg) || 25,
          notes: f.notes || '',
          status: f.status || 'active',
          createdBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 3. Stage Sales Units
    for (const su of data['sales_units'] || []) {
      const unitId = String(su.id).trim();
      if (duplicateStrategy === 'skip' && existingSalesUnitIds.has(unitId)) {
        recordsSkipped++;
        continue;
      }
      const ref = doc(db, 'farms', farm.farmId, 'salesUnits', unitId);
      foundationalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: unitId,
          farmId: farm.farmId,
          name: su.name || 'Crate',
          eggCountPerUnit: Number(su.egg_count_per_unit) || 30,
          currentPriceNgn: Number(su.current_price_ngn) || 0,
          effectiveDate: su.effective_date || nowIso.slice(0, 10),
          status: su.status || 'active',
          createdBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 4. Stage Customers & Vendors
    for (const c of data['customers'] || []) {
      const custId = String(c.id).trim();
      if (duplicateStrategy === 'skip' && existingCustomerIds.has(custId)) {
        recordsSkipped++;
        continue;
      }
      const ref = doc(db, 'farms', farm.farmId, 'customers', custId);
      foundationalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: custId,
          farmId: farm.farmId,
          name: c.name || '',
          phone: c.phone || '',
          email: c.email || '',
          address: c.address || '',
          notes: c.notes || '',
          openingBalanceNgn: Number(c.opening_balance_ngn) || 0,
          openingBalanceDate: c.opening_balance_date || nowIso.slice(0, 10),
          status: c.status || 'active',
          createdBy: member.uid,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    for (const v of data['vendors'] || []) {
      const vendId = String(v.id).trim();
      if (duplicateStrategy === 'skip' && existingVendorIds.has(vendId)) {
        recordsSkipped++;
        continue;
      }
      const ref = doc(db, 'farms', farm.farmId, 'vendors', vendId);
      foundationalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: vendId,
          farmId: farm.farmId,
          name: v.name || '',
          phone: v.phone || '',
          email: v.email || '',
          address: v.address || '',
          notes: v.notes || '',
          openingBalanceNgn: Number(v.opening_balance_ngn) || 0,
          openingBalanceDate: v.opening_balance_date || nowIso.slice(0, 10),
          status: v.status || 'active',
          createdBy: member.uid,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 5. Stage Batches
    for (const b of data['batches'] || []) {
      const batchId = String(b.id).trim();
      if (duplicateStrategy === 'skip' && existingBatchIds.has(batchId)) {
        recordsSkipped++;
        continue;
      }
      const batchCode = (b.batch_code || '').trim().toUpperCase();
      const penId = b.pen_id;
      const penName = penNameMap.get(penId) || 'Pen';

      const ref = doc(db, 'farms', farm.farmId, 'batches', batchId);
      const codeKey = toCodeKey(batchCode);
      const codeLockRef = doc(db, 'farms', farm.farmId, 'batchCodes', codeKey);

      foundationalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: batchId,
          farmId: farm.farmId,
          batchCode,
          penId,
          penNameSnapshot: penName,
          birdType: b.bird_type || 'Layer',
          animalType: b.animal_type || 'Chicken',
          productionType: b.production_type || '',
          productionStage: b.production_stage || '',
          breed: b.breed || 'ISA Brown',
          strain: b.strain || '',
          source: b.source || '',
          hatchDate: b.hatch_date || '',
          ageAtPlacementDays: Number(b.age_at_placement_days) || 0,
          placementDate: b.placement_date,
          initialCount: Number(b.initial_count) || 100,
          maleCount: Number(b.male_count) || 0,
          femaleCount: Number(b.female_count) || 0,
          remarks: b.remarks || '',
          status: b.status || 'active',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });

      // Also set batchCode lock (merge:true so re-import doesn't fail on update)
      foundationalOps.push({
        ref: codeLockRef,
        merge: true,
        data: {
          codeKey,
          farmId: farm.farmId,
          batchId,
          createdAt: serverTimestamp(),
        },
      });

      recordsImported++;
    }

    // 6. Stage Egg Production + ProductionRecords (parent docs)
    // Collect unique parentIds so we write one productionRecord per batch+date
    const stagedProductionParents = new Set<string>();

    for (const p of data['egg_production'] || []) {
      const prodId = String(p.id).trim();
      const batch = batchObjectMap.get(p.batch_id);
      const penName = penNameMap.get(p.pen_id) || '';
      const batchCode = batchCodeMap.get(p.batch_id) || '';
      const crates = Number(p.crates) || 0;
      const pieces = Number(p.pieces) || 0;
      const intact = Number(p.intact_eggs) || (crates * 30 + pieces);
      const cracked = Number(p.cracked_eggs) || 0;
      const damaged = Number(p.damaged_eggs) || 0;
      const total = Number(p.total_eggs) || (intact + cracked + damaged);
      const birdAge = batch ? safeCalculateBirdAge(batch, p.transaction_date) : 0;
      const parentId = parentIdFor(p.batch_id, p.transaction_date);

      // Stage the productionRecord parent (once per batch+date)
      if (!stagedProductionParents.has(parentId)) {
        stagedProductionParents.add(parentId);
        const parentRef = doc(db, 'farms', farm.farmId, 'productionRecords', parentId);
        transactionalOps.push({
          ref: parentRef,
          merge: true, // safe for re-imports
          data: {
            id: parentId,
            farmId: farm.farmId,
            batchId: p.batch_id,
            batchCodeSnapshot: batchCode,
            transactionDate: p.transaction_date,
            status: 'APPROVED',
            createdBy: member.uid,
            createdByName: member.displayName.slice(0, 150),
            updatedBy: member.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            approvedBy: member.uid,
            approvedByName: member.displayName.slice(0, 150),
            approvedAt: serverTimestamp(),
            approvalAuditId: '',
          },
        });
      }

      const ref = doc(db, 'farms', farm.farmId, 'eggProduction', prodId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: prodId,
          farmId: farm.farmId,
          parentId,
          transactionDate: p.transaction_date,
          transactionTime: p.transaction_time || '08:00',
          batchId: p.batch_id,
          batchCodeSnapshot: batchCode,
          penId: p.pen_id,
          penNameSnapshot: penName,
          birdAgeDaysAtTransaction: birdAge,
          crates,
          pieces,
          intactEggs: intact,
          crackedEggs: cracked,
          damagedEggs: damaged,
          totalEggs: total,
          remarks: p.remarks || '',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          status: 'APPROVED',
          approvedBy: member.uid,
          approvedByName: member.displayName,
          approvedAt: serverTimestamp(),
          approvalAuditId: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 7. Stage Mortality Records
    for (const m of data['mortality_records'] || []) {
      const mortId = String(m.id).trim();
      const batch = batchObjectMap.get(m.batch_id);
      const penName = penNameMap.get(m.pen_id) || '';
      const batchCode = batchCodeMap.get(m.batch_id) || '';
      const birdAge = batch ? safeCalculateBirdAge(batch, m.transaction_date) : 0;
      const mortParentId = mortParentIdFor(m.batch_id, m.transaction_date);

      const ref = doc(db, 'farms', farm.farmId, 'mortalityEntries', mortId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: mortId,
          farmId: farm.farmId,
          parentId: mortParentId,
          transactionDate: m.transaction_date,
          timeOfDay: m.time_of_day || 'morning',
          batchId: m.batch_id,
          batchCodeSnapshot: batchCode,
          penId: m.pen_id,
          penNameSnapshot: penName,
          birdAgeDaysAtTransaction: birdAge,
          mortalityCount: Number(m.mortality_count) || 1,
          reasonCategory: m.reason_category || 'Unknown',
          reasonDetail: m.reason_detail || '',
          remarks: m.remarks || '',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          status: 'APPROVED',
          approvedBy: member.uid,
          approvedByName: member.displayName,
          approvedAt: serverTimestamp(),
          approvalAuditId: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 8. Stage Feed Purchases
    for (const fp of data['feed_purchases'] || []) {
      const purchId = String(fp.id).trim();
      const feedMeta = feedTypeMap.get(fp.feed_item_id) || { type: '', brand: '', bagWeight: 25 };
      const bagWeight = Number(fp.bag_weight_kg) || feedMeta.bagWeight || 25;
      const qty = Number(fp.entered_quantity) || 0;
      const unit = fp.entered_unit || 'bags';
      const stdGrams = unit === 'bags' ? qty * bagWeight * 1000 : qty * 1000;
      const unitPrice = Number(fp.unit_purchase_price_ngn) || 0;
      const totalCost = Number(fp.total_cost_ngn) || qty * unitPrice;
      const unitCostPerGram = stdGrams > 0 ? totalCost / stdGrams : 0;

      const ref = doc(db, 'farms', farm.farmId, 'feedPurchases', purchId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: purchId,
          farmId: farm.farmId,
          transactionDate: fp.transaction_date,
          feedItemId: fp.feed_item_id,
          feedTypeSnapshot: feedMeta.type,
          brandSnapshot: feedMeta.brand,
          enteredQuantity: qty,
          enteredUnit: unit,
          bagWeightKgSnapshot: bagWeight,
          standardizedGrams: stdGrams,
          unitPurchasePriceNgn: unitPrice,
          totalCostNgn: totalCost,
          unitCostPerGramNgn: unitCostPerGram,
          supplier: fp.supplier || '',
          reference: fp.reference || '',
          remarks: fp.remarks || '',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 9. Stage Feed Consumptions
    for (const fc of data['feed_consumption'] || []) {
      const consId = String(fc.id).trim();
      const feedMeta = feedTypeMap.get(fc.feed_item_id) || { type: '', brand: '', bagWeight: 25 };
      const penName = penNameMap.get(fc.pen_id) || '';
      const batchCode = batchCodeMap.get(fc.batch_id) || '';
      const bagWeight = Number(fc.bag_weight_kg) || feedMeta.bagWeight || 25;
      const qty = Number(fc.entered_quantity) || 0;
      const unit = fc.entered_unit || 'bags';
      const stdGrams = unit === 'bags' ? qty * bagWeight * 1000 : qty * 1000;

      const ref = doc(db, 'farms', farm.farmId, 'feedConsumption', consId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: consId,
          farmId: farm.farmId,
          transactionDate: fc.transaction_date,
          transactionTime: fc.transaction_time || '08:00',
          batchId: fc.batch_id,
          batchCodeSnapshot: batchCode,
          penId: fc.pen_id,
          penNameSnapshot: penName,
          feedItemId: fc.feed_item_id,
          feedTypeSnapshot: feedMeta.type,
          brandSnapshot: feedMeta.brand,
          enteredQuantity: qty,
          enteredUnit: unit,
          bagWeightKgSnapshot: bagWeight,
          standardizedGrams: stdGrams,
          costSourcePurchaseId: '',
          costSourcePurchaseDate: '',
          unitCostPerGramNgn: 0,
          totalCostNgn: Number(fc.total_cost_ngn) || 0,
          remarks: fc.remarks || '',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 10. Stage Medication Logs
    for (const ml of data['medication_records'] || []) {
      const medId = String(ml.id).trim();
      const batch = batchObjectMap.get(ml.batch_id);
      const penName = penNameMap.get(ml.pen_id) || '';
      const batchCode = batchCodeMap.get(ml.batch_id) || '';
      const birdAge = batch ? safeCalculateBirdAge(batch, ml.transaction_date) : 0;

      const ref = doc(db, 'farms', farm.farmId, 'medicationLogs', medId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: medId,
          farmId: farm.farmId,
          transactionDate: ml.transaction_date,
          timeOfDay: ml.time_of_day || 'morning',
          transactionTime: ml.transaction_time || '08:00',
          batchId: ml.batch_id,
          batchCodeSnapshot: batchCode,
          penId: ml.pen_id,
          penNameSnapshot: penName,
          birdAgeDaysAtTransaction: birdAge,
          medicationName: ml.medication_name || '',
          treatmentType: ml.treatment_type || 'medication',
          dosage: ml.dosage || '',
          administrationRoute: ml.administration_route || '',
          remarks: ml.remarks || '',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 11. Stage Environment Logs
    for (const el of data['environment_records'] || []) {
      const envId = String(el.id).trim();
      const batch = batchObjectMap.get(el.batch_id);
      const penName = penNameMap.get(el.pen_id) || '';
      const batchCode = batchCodeMap.get(el.batch_id) || '';
      const birdAge = batch ? safeCalculateBirdAge(batch, el.transaction_date) : 0;

      const ref = doc(db, 'farms', farm.farmId, 'environmentLogs', envId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: envId,
          farmId: farm.farmId,
          transactionDate: el.transaction_date,
          timeOfDay: el.time_of_day || 'morning',
          transactionTime: el.transaction_time || '07:00',
          batchId: el.batch_id,
          batchCodeSnapshot: batchCode,
          penId: el.pen_id,
          penNameSnapshot: penName,
          birdAgeDaysAtTransaction: birdAge,
          averageWeightGrams: el.average_weight_grams !== null && el.average_weight_grams !== undefined ? Number(el.average_weight_grams) : null,
          sampleSize: Number(el.sample_size) || 0,
          temperatureC: el.temperature_c !== null && el.temperature_c !== undefined ? Number(el.temperature_c) : null,
          humidityPct: el.humidity_pct !== null && el.humidity_pct !== undefined ? Number(el.humidity_pct) : null,
          remarks: el.remarks || '',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 12. Stage Egg Sales
    for (const s of data['egg_sales'] || []) {
      const saleId = String(s.id).trim();
      const suMeta = salesUnitMap.get(s.sales_unit_id) || { name: 'Crate', eggsPerUnit: 30, price: 0 };
      const qty = Number(s.quantity) || 0;
      const unitPrice = Number(s.unit_price_ngn) || 0;
      const totalAmt = Number(s.total_amount_ngn) || qty * unitPrice;
      const totalEggs = Number(s.total_eggs_equivalent) || qty * suMeta.eggsPerUnit;
      const batchCode = s.batch_id ? batchCodeMap.get(s.batch_id) || '' : '';

      const ref = doc(db, 'farms', farm.farmId, 'eggSales', saleId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: saleId,
          farmId: farm.farmId,
          transactionDate: s.transaction_date,
          transactionTime: s.transaction_time || '10:00',
          customerName: s.customer_name || 'Customer',
          eggCategory: s.egg_category || 'Table Eggs',
          salesUnitId: s.sales_unit_id || '',
          unitNameSnapshot: suMeta.name,
          eggsPerUnitSnapshot: suMeta.eggsPerUnit,
          quantity: qty,
          totalEggsEquivalent: totalEggs,
          suggestedUnitPriceNgn: unitPrice,
          unitPriceNgn: unitPrice,
          priceOverridden: false,
          overrideReason: '',
          totalAmountNgn: totalAmt,
          paymentStatus: s.payment_status || 'paid',
          receivedAmountNgn: Number(s.received_amount_ngn) || totalAmt,
          balanceDueNgn: Number(s.balance_due_ngn) || 0,
          batchId: s.batch_id || '',
          batchCodeSnapshot: batchCode,
          remarks: s.remarks || '',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 13. Stage Farm Purchases
    for (const fp of data['farm_purchases'] || []) {
      const purchId = String(fp.id).trim();
      const batchCode = fp.batch_id ? batchCodeMap.get(fp.batch_id) || '' : '';
      const qty = Number(fp.quantity) || 0;
      const unitPrice = Number(fp.unit_price_ngn) || 0;
      const totalCost = Number(fp.total_cost_ngn) || qty * unitPrice;

      const ref = doc(db, 'farms', farm.farmId, 'farmPurchases', purchId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: purchId,
          farmId: farm.farmId,
          transactionDate: fp.transaction_date,
          category: fp.category || 'other',
          itemName: fp.item_name || '',
          quantity: qty,
          unit: fp.unit || 'unit',
          unitPriceNgn: unitPrice,
          totalCostNgn: totalCost,
          supplier: fp.supplier || '',
          reference: fp.reference || '',
          batchId: fp.batch_id || '',
          batchCodeSnapshot: batchCode,
          remarks: fp.remarks || '',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 14. Stage Care Plans & Items
    for (const cp of data['care_plans'] || []) {
      const planId = String(cp.id).trim();
      const ref = doc(db, 'farms', farm.farmId, 'carePlans', planId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: planId,
          farmId: farm.farmId,
          name: cp.name || 'Care Plan',
          description: cp.description || '',
          planType: cp.plan_type || 'vaccination',
          animalType: cp.animal_type || 'Chicken',
          productionType: cp.production_type || '',
          productionStage: cp.production_stage || '',
          schedulingReference: cp.scheduling_reference || 'placement',
          status: cp.status || 'active',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    for (const cpi of data['care_plan_items'] || []) {
      const itemId = String(cpi.id).trim();
      const planId = cpi.care_plan_id;
      const ref = doc(db, 'farms', farm.farmId, 'carePlans', planId, 'items', itemId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: itemId,
          carePlanId: planId,
          farmId: farm.farmId,
          title: cpi.title || 'Care Activity',
          reminderType: cpi.reminder_type || 'vaccination',
          dosageOrAction: cpi.dosage_or_action || '',
          notes: cpi.notes || '',
          offsetDays: Number(cpi.offset_days) || 0,
          intervalUnit: cpi.interval_unit || 'once',
          intervalValue: Number(cpi.interval_value) || 1,
          sortOrder: Number(cpi.sort_order) || 0,
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 15. Stage Farm Reminders
    for (const r of data['farm_reminders'] || []) {
      const remId = String(r.id).trim();
      const penName = penNameMap.get(r.pen_id) || '';
      const batchCode = batchCodeMap.get(r.batch_id) || '';

      const ref = doc(db, 'farms', farm.farmId, 'farmReminders', remId);
      transactionalOps.push({
        ref,
        merge: duplicateStrategy === 'update',
        data: {
          id: remId,
          farmId: farm.farmId,
          batchId: r.batch_id,
          batchCodeSnapshot: batchCode,
          penId: r.pen_id,
          penNameSnapshot: penName,
          milestoneKey: r.milestone_key || '',
          reminderType: r.reminder_type || 'vaccination',
          title: r.title || 'Farm Reminder',
          dueDate: r.due_date,
          targetAgeDays: r.target_age_days !== null && r.target_age_days !== undefined ? Number(r.target_age_days) : null,
          dosageOrAction: r.dosage_or_action || '',
          notes: r.notes || '',
          status: r.status || 'pending',
          completedAtDate: '',
          completedBy: '',
          completedByName: '',
          createdBy: member.uid,
          createdByName: member.displayName,
          updatedBy: member.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      recordsImported++;
    }

    // 16. Stage Import History Entry & Audit Log
    const historyRef = doc(db, 'farms', farm.farmId, 'importHistory', importId);
    const summaryText = `Bulk import of ${recordsImported} records from ${originalFileName}.`;
    transactionalOps.push({
      ref: historyRef,
      data: {
        id: importId,
        originalFileName,
        importDate: nowIso,
        actorUid: member.uid,
        actorName: member.displayName,
        farmId: farm.farmId,
        recordsImported,
        recordsSkipped,
        recordsFailed,
        status: 'completed',
        schemaVersion: SCHEMA_VERSION,
        summary: summaryText,
        createdAt: serverTimestamp(),
      },
    });

    const audit = buildAuditLogEntry({
      farmId: farm.farmId,
      entityType: 'data_import',
      entityId: importId,
      action: 'create',
      summary: summaryText,
      actorUid: member.uid,
      actorName: member.displayName,
      after: {
        recordsImported,
        originalFileName,
        schemaVersion: SCHEMA_VERSION,
      },
    });
    transactionalOps.push(audit);

    // --- Two-phase commit ---
    // Phase 1: foundational (pens, feeds, units, customers, vendors, batches, batchCodes)
    const CHUNK_SIZE = 400;
    const totalFoundational = foundationalOps.length;
    for (let i = 0; i < totalFoundational; i += CHUNK_SIZE) {
      const chunk = foundationalOps.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const op of chunk) {
        if (op.merge) {
          batch.set(op.ref, op.data, { merge: true });
        } else {
          batch.set(op.ref, op.data);
        }
      }
      await batch.commit();

      if (options.onProgress) {
        const currentCount = Math.min(i + CHUNK_SIZE, totalFoundational);
        options.onProgress({
          stage: 'Writing foundational records...',
          current: currentCount,
          total: totalFoundational + transactionalOps.length,
          percent: Math.round((currentCount / (totalFoundational + transactionalOps.length)) * 100),
        });
      }
    }

    // Phase 2: transactional (production, mortality, feeds, sales, etc.)
    const totalTransactional = transactionalOps.length;
    for (let i = 0; i < totalTransactional; i += CHUNK_SIZE) {
      const chunk = transactionalOps.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const op of chunk) {
        if (op.merge) {
          batch.set(op.ref, op.data, { merge: true });
        } else {
          batch.set(op.ref, op.data);
        }
      }
      await batch.commit();

      if (options.onProgress) {
        const currentCount = totalFoundational + Math.min(i + CHUNK_SIZE, totalTransactional);
        options.onProgress({
          stage: 'Writing transaction records...',
          current: currentCount,
          total: totalFoundational + totalTransactional,
          percent: Math.round((currentCount / (totalFoundational + totalTransactional)) * 100),
        });
      }
    }

    return {
      importId,
      success: true,
      recordsImported,
      recordsSkipped,
      recordsFailed: 0,
      message: `Successfully imported ${recordsImported} records into ${farm.name}.`,
    };
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, `farms/${farm.farmId}/dataImport`);
    return {
      importId,
      success: false,
      recordsImported: 0,
      recordsSkipped: 0,
      recordsFailed: recordsImported,
      message: `Import failed: ${err?.message || 'Database transaction error.'}`,
      error: err?.message,
    };
  }
}
/**
 * Subscribe to import history entries for the active farm.
 */
export function subscribeImportHistory(
  farmId: string,
  onData: (history: ImportHistoryEntry[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, 'farms', farmId, 'importHistory'),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snap) => {
      const items: ImportHistoryEntry[] = [];
      for (const docSnap of snap.docs) {
        items.push(docSnap.data() as ImportHistoryEntry);
      }
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}
