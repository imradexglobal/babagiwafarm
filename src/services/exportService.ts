/**
 * Service to generate portable SQLite database exports for external data analysis.
 */

import JSZip from 'jszip';
import { getSqlInstance } from './sqliteEngine.ts';
import {
  APPLICATION_NAME,
  generateReadmeDocumentation,
  generateSchemaSql,
  generateTableDocumentation,
  SCHEMA_VERSION,
  TABLE_DEFINITIONS,
  TEMPLATE_VERSION,
} from './importExportSchema.ts';
import type {
  CarePlan,
  EggProductionEntry,
  EggSale,
  EnvironmentMetricLog,
  Farm,
  FarmPurchase,
  FarmReminder,
  FeedConsumption,
  FeedItem,
  FeedPurchase,
  MedicationLog,
  MortalityEntry,
  Pen,
  PoultryBatch,
  SalesUnit,
} from '../types/farm.ts';
import type { Customer, Vendor } from '../types/accounts.ts';

export interface FarmExportDataset {
  farm: Farm;
  pens: Pen[];
  feedItems: FeedItem[];
  salesUnits: SalesUnit[];
  customers: Customer[];
  vendors: Vendor[];
  batches: PoultryBatch[];
  production: EggProductionEntry[];
  mortalityEntries: MortalityEntry[];
  feedPurchases: FeedPurchase[];
  consumptions: FeedConsumption[];
  medicationLogs: MedicationLog[];
  environmentLogs: EnvironmentMetricLog[];
  sales: EggSale[];
  farmPurchases: FarmPurchase[];
  carePlans: CarePlan[];
  carePlanItems?: any[];
  farmReminders: FarmReminder[];
}

export interface FarmExportResult {
  fileNameDb: string;
  fileNameZip: string;
  dbBytes: Uint8Array;
  zipBytes: Uint8Array;
  recordCounts: Record<string, number>;
  totalRecords: number;
}

/**
 * Creates the complete populated SQLite database for an authorized farm.
 */
export async function createFarmExportDatabase(dataset: FarmExportDataset): Promise<FarmExportResult> {
  const SQL = await getSqlInstance();
  const db = new SQL.Database();

  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;

  try {
    // 1. Create tables and indexes
    const ddl = generateSchemaSql();
    db.run(ddl);

    // 2. Insert metadata
    const nowIso = new Date().toISOString();
    const metadataEntries = [
      ['template_name', 'Babagiwa Farm Data Export'],
      ['template_version', TEMPLATE_VERSION],
      ['schema_version', SCHEMA_VERSION],
      ['application_name', APPLICATION_NAME],
      ['generation_date', nowIso],
      ['farm_id', dataset.farm.farmId],
      ['farm_name', dataset.farm.name],
      ['currency', dataset.farm.currency],
      ['timezone', dataset.farm.timezone],
      ['export_type', 'full_export'],
    ];

    for (const [key, val] of metadataEntries) {
      db.run('INSERT INTO _template_metadata (key, value) VALUES (?, ?);', [key, val]);
    }

    // Helper to run parameterized insert
    const insertRow = (tableName: string, colNames: string[], values: any[]) => {
      const placeholders = colNames.map(() => '?').join(', ');
      const sql = `INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${placeholders});`;
      db.run(sql, values);
    };

    // 3. Pens
    const penCols = ['id', 'name', 'code', 'capacity', 'sector', 'department', 'notes', 'status'];
    for (const p of dataset.pens) {
      insertRow(
        'pens',
        penCols,
        [p.id, p.name, p.code, p.capacity, p.sector || 'poultry', p.department || 'poultry', p.notes || '', p.status || 'active']
      );
    }
    recordCounts['pens'] = dataset.pens.length;
    totalRecords += dataset.pens.length;

    // 4. Feed Items
    const feedItemCols = ['id', 'feed_type', 'brand', 'default_bag_weight_kg', 'notes', 'status'];
    for (const f of dataset.feedItems) {
      insertRow(
        'feed_items',
        feedItemCols,
        [f.id, f.feedType, f.brand, f.defaultBagWeightKg || 25, f.notes || '', f.status || 'active']
      );
    }
    recordCounts['feed_items'] = dataset.feedItems.length;
    totalRecords += dataset.feedItems.length;

    // 5. Sales Units
    const suCols = ['id', 'name', 'egg_count_per_unit', 'current_price_ngn', 'effective_date', 'status'];
    for (const su of dataset.salesUnits) {
      insertRow(
        'sales_units',
        suCols,
        [su.id, su.name, su.eggCountPerUnit || 30, su.currentPriceNgn || 0, su.effectiveDate || '', su.status || 'active']
      );
    }
    recordCounts['sales_units'] = dataset.salesUnits.length;
    totalRecords += dataset.salesUnits.length;

    // 6. Customers
    const custCols = ['id', 'name', 'phone', 'email', 'address', 'opening_balance_ngn', 'opening_balance_date', 'notes', 'status'];
    for (const c of dataset.customers) {
      insertRow(
        'customers',
        custCols,
        [c.id, c.name, c.phone || '', c.email || '', c.address || '', c.openingBalanceNgn || 0, c.openingBalanceDate || '', c.notes || '', c.status || 'active']
      );
    }
    recordCounts['customers'] = dataset.customers.length;
    totalRecords += dataset.customers.length;

    // 7. Vendors
    const vendCols = ['id', 'name', 'phone', 'email', 'address', 'opening_balance_ngn', 'opening_balance_date', 'notes', 'status'];
    for (const v of dataset.vendors) {
      insertRow(
        'vendors',
        vendCols,
        [v.id, v.name, v.phone || '', v.email || '', v.address || '', v.openingBalanceNgn || 0, v.openingBalanceDate || '', v.notes || '', v.status || 'active']
      );
    }
    recordCounts['vendors'] = dataset.vendors.length;
    totalRecords += dataset.vendors.length;

    // 8. Batches
    const batchCols = [
      'id',
      'batch_code',
      'pen_id',
      'bird_type',
      'animal_type',
      'production_type',
      'production_stage',
      'breed',
      'strain',
      'source',
      'hatch_date',
      'age_at_placement_days',
      'placement_date',
      'initial_count',
      'male_count',
      'female_count',
      'remarks',
      'status',
    ];
    for (const b of dataset.batches) {
      insertRow(
        'batches',
        batchCols,
        [
          b.id,
          b.batchCode,
          b.penId,
          b.birdType,
          b.animalType || 'Chicken',
          b.productionType || '',
          b.productionStage || '',
          b.breed,
          b.strain || '',
          b.source,
          b.hatchDate || '',
          b.ageAtPlacementDays || 0,
          b.placementDate,
          b.initialCount,
          b.maleCount || 0,
          b.femaleCount || 0,
          b.remarks || '',
          b.status || 'active',
        ]
      );
    }
    recordCounts['batches'] = dataset.batches.length;
    totalRecords += dataset.batches.length;

    // 9. Egg Production (exclude voided)
    const prodCols = [
      'id',
      'transaction_date',
      'transaction_time',
      'batch_id',
      'pen_id',
      'crates',
      'pieces',
      'intact_eggs',
      'cracked_eggs',
      'damaged_eggs',
      'total_eggs',
      'remarks',
      'status',
    ];
    const nonVoidedProd = dataset.production.filter((p) => !p.isVoided);
    for (const p of nonVoidedProd) {
      insertRow(
        'egg_production',
        prodCols,
        [
          p.id,
          p.transactionDate,
          p.transactionTime || '',
          p.batchId,
          p.penId,
          p.crates || 0,
          p.pieces || 0,
          p.intactEggs || 0,
          p.crackedEggs || 0,
          p.damagedEggs || 0,
          p.totalEggs || 0,
          p.remarks || '',
          p.status || 'APPROVED',
        ]
      );
    }
    recordCounts['egg_production'] = nonVoidedProd.length;
    totalRecords += nonVoidedProd.length;

    // 10. Mortality Entries (exclude voided)
    const mortCols = [
      'id',
      'transaction_date',
      'time_of_day',
      'batch_id',
      'pen_id',
      'mortality_count',
      'reason_category',
      'reason_detail',
      'remarks',
    ];
    const nonVoidedMort = dataset.mortalityEntries.filter((m) => !m.isVoided);
    for (const m of nonVoidedMort) {
      insertRow(
        'mortality_records',
        mortCols,
        [
          m.id,
          m.transactionDate,
          m.timeOfDay || 'morning',
          m.batchId,
          m.penId,
          m.mortalityCount,
          m.reasonCategory,
          m.reasonDetail || '',
          m.remarks || '',
        ]
      );
    }
    recordCounts['mortality_records'] = nonVoidedMort.length;
    totalRecords += nonVoidedMort.length;

    // 11. Feed Purchases (exclude voided)
    const fpCols = [
      'id',
      'transaction_date',
      'feed_item_id',
      'entered_quantity',
      'entered_unit',
      'bag_weight_kg',
      'unit_purchase_price_ngn',
      'total_cost_ngn',
      'supplier',
      'reference',
      'remarks',
    ];
    const nonVoidedFp = dataset.feedPurchases.filter((fp) => !fp.isVoided);
    for (const fp of nonVoidedFp) {
      insertRow(
        'feed_purchases',
        fpCols,
        [
          fp.id,
          fp.transactionDate,
          fp.feedItemId,
          fp.enteredQuantity,
          fp.enteredUnit || 'bags',
          fp.bagWeightKgSnapshot || 25,
          fp.unitPurchasePriceNgn,
          fp.totalCostNgn,
          fp.supplier || '',
          fp.reference || '',
          fp.remarks || '',
        ]
      );
    }
    recordCounts['feed_purchases'] = nonVoidedFp.length;
    totalRecords += nonVoidedFp.length;

    // 12. Feed Consumption (exclude voided)
    const fcCols = [
      'id',
      'transaction_date',
      'transaction_time',
      'batch_id',
      'pen_id',
      'feed_item_id',
      'entered_quantity',
      'entered_unit',
      'bag_weight_kg',
      'total_cost_ngn',
      'remarks',
    ];
    const nonVoidedFc = dataset.consumptions.filter((fc) => !fc.isVoided);
    for (const fc of nonVoidedFc) {
      insertRow(
        'feed_consumption',
        fcCols,
        [
          fc.id,
          fc.transactionDate,
          fc.transactionTime || '',
          fc.batchId,
          fc.penId,
          fc.feedItemId,
          fc.enteredQuantity,
          fc.enteredUnit || 'bags',
          fc.bagWeightKgSnapshot || 25,
          fc.totalCostNgn || 0,
          fc.remarks || '',
        ]
      );
    }
    recordCounts['feed_consumption'] = nonVoidedFc.length;
    totalRecords += nonVoidedFc.length;

    // 13. Medication Logs (exclude voided)
    const medCols = [
      'id',
      'transaction_date',
      'time_of_day',
      'transaction_time',
      'batch_id',
      'pen_id',
      'treatment_type',
      'medication_name',
      'dosage',
      'administration_route',
      'remarks',
    ];
    const nonVoidedMed = dataset.medicationLogs.filter((ml) => !ml.isVoided);
    for (const ml of nonVoidedMed) {
      insertRow(
        'medication_records',
        medCols,
        [
          ml.id,
          ml.transactionDate,
          ml.timeOfDay || 'morning',
          ml.transactionTime || '',
          ml.batchId,
          ml.penId,
          ml.treatmentType,
          ml.medicationName,
          ml.dosage,
          ml.administrationRoute,
          ml.remarks || '',
        ]
      );
    }
    recordCounts['medication_records'] = nonVoidedMed.length;
    totalRecords += nonVoidedMed.length;

    // 14. Environment Logs (exclude voided)
    const envCols = [
      'id',
      'transaction_date',
      'time_of_day',
      'transaction_time',
      'batch_id',
      'pen_id',
      'average_weight_grams',
      'sample_size',
      'temperature_c',
      'humidity_pct',
      'remarks',
    ];
    const nonVoidedEnv = dataset.environmentLogs.filter((el) => !el.isVoided);
    for (const el of nonVoidedEnv) {
      insertRow(
        'environment_records',
        envCols,
        [
          el.id,
          el.transactionDate,
          el.timeOfDay || 'morning',
          el.transactionTime || '',
          el.batchId,
          el.penId,
          el.averageWeightGrams,
          el.sampleSize || 0,
          el.temperatureC,
          el.humidityPct,
          el.remarks || '',
        ]
      );
    }
    recordCounts['environment_records'] = nonVoidedEnv.length;
    totalRecords += nonVoidedEnv.length;

    // 15. Egg Sales (exclude voided)
    const saleCols = [
      'id',
      'transaction_date',
      'transaction_time',
      'customer_name',
      'egg_category',
      'sales_unit_id',
      'quantity',
      'total_eggs_equivalent',
      'unit_price_ngn',
      'total_amount_ngn',
      'payment_status',
      'received_amount_ngn',
      'balance_due_ngn',
      'batch_id',
      'remarks',
    ];
    const nonVoidedSales = dataset.sales.filter((s) => !s.isVoided);
    for (const s of nonVoidedSales) {
      insertRow(
        'egg_sales',
        saleCols,
        [
          s.id,
          s.transactionDate,
          s.transactionTime || '',
          s.customerName,
          s.eggCategory || 'Table Eggs',
          s.salesUnitId || '',
          s.quantity,
          s.totalEggsEquivalent,
          s.unitPriceNgn,
          s.totalAmountNgn,
          s.paymentStatus || 'paid',
          s.receivedAmountNgn || s.totalAmountNgn,
          s.balanceDueNgn || 0,
          s.batchId || '',
          s.remarks || '',
        ]
      );
    }
    recordCounts['egg_sales'] = nonVoidedSales.length;
    totalRecords += nonVoidedSales.length;

    // 16. Farm Purchases (exclude voided)
    const farmPurchCols = [
      'id',
      'transaction_date',
      'category',
      'item_name',
      'quantity',
      'unit',
      'unit_price_ngn',
      'total_cost_ngn',
      'supplier',
      'reference',
      'batch_id',
      'remarks',
    ];
    const nonVoidedFarmPurch = dataset.farmPurchases.filter((fp) => !fp.isVoided);
    for (const fp of nonVoidedFarmPurch) {
      insertRow(
        'farm_purchases',
        farmPurchCols,
        [
          fp.id,
          fp.transactionDate,
          fp.category,
          fp.itemName,
          fp.quantity,
          fp.unit,
          fp.unitPriceNgn,
          fp.totalCostNgn,
          fp.supplier || '',
          fp.reference || '',
          fp.batchId || '',
          fp.remarks || '',
        ]
      );
    }
    recordCounts['farm_purchases'] = nonVoidedFarmPurch.length;
    totalRecords += nonVoidedFarmPurch.length;

    // 17. Care Plans
    const cpCols = [
      'id',
      'name',
      'description',
      'plan_type',
      'animal_type',
      'production_type',
      'production_stage',
      'scheduling_reference',
      'status',
    ];
    for (const cp of dataset.carePlans) {
      insertRow(
        'care_plans',
        cpCols,
        [
          cp.id,
          cp.name,
          cp.description || '',
          cp.planType,
          cp.animalType || 'Chicken',
          cp.productionType || '',
          cp.productionStage || '',
          cp.schedulingReference || 'placement',
          cp.status || 'active',
        ]
      );
    }
    recordCounts['care_plans'] = dataset.carePlans.length;
    totalRecords += dataset.carePlans.length;

    // 18. Care Plan Items (if available)
    if (dataset.carePlanItems && dataset.carePlanItems.length > 0) {
      const cpiCols = [
        'id',
        'care_plan_id',
        'title',
        'reminder_type',
        'dosage_or_action',
        'notes',
        'offset_days',
        'interval_unit',
        'interval_value',
        'sort_order',
      ];
      for (const cpi of dataset.carePlanItems) {
        insertRow(
          'care_plan_items',
          cpiCols,
          [
            cpi.id,
            cpi.carePlanId,
            cpi.title,
            cpi.reminderType,
            cpi.dosageOrAction || '',
            cpi.notes || '',
            cpi.offsetDays || 0,
            cpi.intervalUnit || 'once',
            cpi.intervalValue || 1,
            cpi.sortOrder || 0,
          ]
        );
      }
      recordCounts['care_plan_items'] = dataset.carePlanItems.length;
      totalRecords += dataset.carePlanItems.length;
    }

    // 19. Farm Reminders
    const remCols = [
      'id',
      'batch_id',
      'pen_id',
      'milestone_key',
      'reminder_type',
      'title',
      'due_date',
      'target_age_days',
      'dosage_or_action',
      'notes',
      'status',
    ];
    for (const r of dataset.farmReminders) {
      insertRow(
        'farm_reminders',
        remCols,
        [
          r.id,
          r.batchId,
          r.penId,
          r.milestoneKey || '',
          r.reminderType,
          r.title,
          r.dueDate,
          r.targetAgeDays,
          r.dosageOrAction || '',
          r.notes || '',
          r.status || 'pending',
        ]
      );
    }
    recordCounts['farm_reminders'] = dataset.farmReminders.length;
    totalRecords += dataset.farmReminders.length;

    const dbBytes = db.export();

    // Prepare clean filenames
    const sanitizedFarmName = dataset.farm.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStamp = nowIso.slice(0, 10).replace(/-/g, '');
    const fileNameDb = `${sanitizedFarmName}_Export_${dateStamp}.db`;
    const fileNameZip = `${sanitizedFarmName}_Export_${dateStamp}.zip`;

    // Build ZIP package
    const zip = new JSZip();
    zip.file(fileNameDb, dbBytes);

    const docFolder = zip.folder('Documentation');
    const readme = generateReadmeDocumentation();
    docFolder?.file('README.txt', readme);

    for (const table of TABLE_DEFINITIONS) {
      docFolder?.file(`${table.tableName}.txt`, generateTableDocumentation(table));
    }

    const zipBytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    return {
      fileNameDb,
      fileNameZip,
      dbBytes,
      zipBytes,
      recordCounts,
      totalRecords,
    };
  } finally {
    db.close();
  }
}
