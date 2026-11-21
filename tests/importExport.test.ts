import test from 'node:test';
import assert from 'node:assert/strict';
import { getSqlInstance, isSqliteFile } from '../src/services/sqliteEngine.ts';
import {
  generateSchemaSql,
  generateTableDocumentation,
  generateReadmeDocumentation,
  TABLE_DEFINITIONS,
  SCHEMA_VERSION,
} from '../src/services/importExportSchema.ts';
import {
  createTemplateDatabase,
  createTemplateZipPackage,
} from '../src/services/templateGenerator.ts';
import {
  validateImportDatabase,
  ExistingFarmContext,
} from '../src/services/importValidator.ts';
import { createFarmExportDatabase } from '../src/services/exportService.ts';
import type { Farm } from '../src/types/farm.ts';

const mockFarm: Farm = {
  farmId: 'test_farm_001',
  name: 'Babagiwa Integrated Farms',
  location: 'Kaduna, Nigeria',
  contactPhone: '+2348012345678',
  contactEmail: 'admin@babagiwafarm.com',
  currency: 'NGN',
  timezone: 'Africa/Lagos',
  activeSectors: ['poultry'],
  ownerUid: 'user_owner_001',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const emptyContext: ExistingFarmContext = {
  farmId: mockFarm.farmId,
  existingPenIds: new Set(),
  existingPenCodes: new Set(),
  existingBatchIds: new Set(),
  existingBatchCodes: new Set(),
  existingFeedItemIds: new Set(),
  existingSalesUnitIds: new Set(),
  existingCustomerIds: new Set(),
  existingVendorIds: new Set(),
  existingCarePlanIds: new Set(),
};

test('Template generation produces a valid SQLite file with all expected tables and metadata', async () => {
  const dbBytes = await createTemplateDatabase();
  assert.ok(isSqliteFile(dbBytes), 'Generated file must have SQLite magic header');
  assert.ok(dbBytes.length > 10000, 'Database size should be realistic');

  const SQL = await getSqlInstance();
  const db = new SQL.Database(dbBytes);

  try {
    const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
    const foundTables = new Set(tablesRes[0].values.map((r: any) => String(r[0])));

    // Verify metadata table exists
    assert.ok(foundTables.has('_template_metadata'), '_template_metadata table must exist');

    // Verify all 17 domain tables exist
    for (const def of TABLE_DEFINITIONS) {
      assert.ok(foundTables.has(def.tableName), `Expected table "${def.tableName}" to exist`);
    }

    // Verify metadata values
    const metaRes = db.exec("SELECT key, value FROM _template_metadata;");
    const metaMap: Record<string, string> = {};
    for (const r of metaRes[0].values) {
      metaMap[String(r[0])] = String(r[1]);
    }

    assert.equal(metaMap['schema_version'], SCHEMA_VERSION);
    assert.equal(metaMap['export_type'], 'template');
    assert.ok(metaMap['generation_date']);
  } finally {
    db.close();
  }
});

test('Documentation files are generated for every table and ZIP package bundles them', async () => {
  const res = await createTemplateZipPackage();
  assert.ok(res.zipBytes.length > 5000, 'ZIP package must be non-empty');
  assert.equal(Object.keys(res.tableDocMap).length, TABLE_DEFINITIONS.length);
  assert.ok(res.readmeText.includes('BABAGIWA FARM MANAGEMENT'));

  for (const table of TABLE_DEFINITIONS) {
    const doc = res.tableDocMap[table.tableName];
    assert.ok(doc, `Documentation missing for ${table.tableName}`);
    assert.ok(doc.includes(table.tableName.toUpperCase()));
    assert.ok(doc.includes('PURPOSE:'));
    assert.ok(doc.includes('COLUMNS & DATA SPECIFICATIONS:'));
  }
});

test('Import validation correctly validates blank template with 0 records and 0 errors', async () => {
  const dbBytes = await createTemplateDatabase();
  const report = await validateImportDatabase(dbBytes, emptyContext);

  assert.equal(report.isValid, true);
  assert.equal(report.totalRecords, 0);
  assert.equal(report.errorRecords, 0);
  assert.equal(report.tableSummaries.length, TABLE_DEFINITIONS.length);
});

test('Import validation rejects non-SQLite files and corrupted data', async () => {
  const dummyBuffer = new TextEncoder().encode('Not a sqlite database file at all');
  const report = await validateImportDatabase(dummyBuffer, emptyContext);

  assert.equal(report.isValid, false);
  assert.equal(report.canProceedWithImport, false);
  assert.ok(report.structuralError?.includes('not a valid SQLite database'));
});

test('Import validation detects missing required fields, invalid dates, negative numbers, and broken relationships', async () => {
  const SQL = await getSqlInstance();
  const db = new SQL.Database();

  try {
    db.run(generateSchemaSql());
    db.run("INSERT INTO _template_metadata VALUES ('schema_version', '1');");

    // Insert Pen
    db.run("INSERT INTO pens (id, name, code, capacity) VALUES ('pen_valid', 'Pen 1', 'PEN-1', 1000);");

    // Insert Batch referencing nonexistent pen
    db.run(`INSERT INTO batches (id, batch_code, pen_id, bird_type, breed, source, placement_date, initial_count)
            VALUES ('b1', 'BATCH-01', 'nonexistent_pen', 'Layer', 'ISA Brown', 'Hatchery A', '2026-01-01', 500);`);

    // Insert Batch with negative counts
    db.run(`INSERT INTO batches (id, batch_code, pen_id, bird_type, breed, source, placement_date, initial_count, male_count)
            VALUES ('b2', 'BATCH-02', 'pen_valid', 'Layer', 'ISA Brown', 'Hatchery A', '2026-01-01', -10, -5);`);

    // Insert Production with invalid date and referencing nonexistent batch
    db.run(`INSERT INTO egg_production (id, transaction_date, batch_id, pen_id, crates, pieces, intact_eggs)
            VALUES ('prod_1', 'bad-date-format', 'nonexistent_batch', 'pen_valid', 10, 5, 305);`);

    // Insert Mortality with negative count
    db.run(`INSERT INTO mortality_records (id, transaction_date, batch_id, pen_id, mortality_count, reason_category)
            VALUES ('mort_1', '2026-01-05', 'b1', 'pen_valid', -2, 'Heat Stress');`);

    const bytes = db.export();
    const report = await validateImportDatabase(bytes, emptyContext);

    assert.equal(report.isValid, false);
    assert.equal(report.canProceedWithImport, false);
    assert.ok(report.errorRecords > 0);

    const errorColumns = report.errors.map((e) => e.column);
    assert.ok(errorColumns.includes('pen_id'), 'Should catch nonexistent pen_id');
    assert.ok(errorColumns.includes('initial_count') || errorColumns.includes('male_count'), 'Should catch negative bird count');
    assert.ok(errorColumns.includes('transaction_date'), 'Should catch invalid date format');
    assert.ok(errorColumns.includes('batch_id'), 'Should catch nonexistent batch_id');
    assert.ok(errorColumns.includes('mortality_count'), 'Should catch negative mortality count');
  } finally {
    db.close();
  }
});

test('Export database generates valid SQLite populated with all operational records and relationships', async () => {
  const exportResult = await createFarmExportDatabase({
    farm: mockFarm,
    pens: [
      {
        id: 'pen-1',
        farmId: mockFarm.farmId,
        name: 'Pen 1',
        code: 'PEN-1',
        capacity: 1500,
        sector: 'poultry',
        activeBatchId: 'b-1',
        notes: 'Good condition',
        status: 'active',
        createdBy: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    feedItems: [
      {
        id: 'feed-1',
        farmId: mockFarm.farmId,
        feedType: 'Layers Mash',
        brand: 'TopFeed',
        defaultBagWeightKg: 25,
        notes: 'Standard',
        status: 'active',
        createdBy: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    salesUnits: [
      {
        id: 'unit-1',
        farmId: mockFarm.farmId,
        name: 'Crate (30 eggs)',
        eggCountPerUnit: 30,
        currentPriceNgn: 4500,
        effectiveDate: '2026-01-01',
        status: 'active',
        createdBy: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    customers: [
      {
        id: 'cust-1',
        farmId: mockFarm.farmId,
        name: 'Amina Store',
        phone: '08012345678',
        email: 'amina@store.com',
        address: 'Kaduna',
        notes: 'Wholesaler',
        openingBalanceNgn: 0,
        openingBalanceDate: '2026-01-01',
        status: 'active',
        createdBy: 'user-1',
        updatedBy: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    vendors: [],
    batches: [
      {
        id: 'b-1',
        farmId: mockFarm.farmId,
        batchCode: 'PEN-1-260101',
        penId: 'pen-1',
        penNameSnapshot: 'Pen 1',
        birdType: 'Layer',
        breed: 'ISA Brown',
        source: 'Chiwetalu',
        hatchDate: '2025-09-01',
        ageAtPlacementDays: 122,
        placementDate: '2026-01-01',
        initialCount: 1200,
        maleCount: 0,
        femaleCount: 1200,
        remarks: 'Healthy',
        status: 'active',
        createdBy: 'user-1',
        createdByName: 'Owner',
        updatedBy: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    production: [
      {
        id: 'prod-1',
        farmId: mockFarm.farmId,
        transactionDate: '2026-01-10',
        transactionTime: '08:00',
        batchId: 'b-1',
        batchCodeSnapshot: 'PEN-1-260101',
        penId: 'pen-1',
        penNameSnapshot: 'Pen 1',
        birdAgeDaysAtTransaction: 131,
        crates: 35,
        pieces: 10,
        intactEggs: 1060,
        crackedEggs: 5,
        damagedEggs: 2,
        totalEggs: 1067,
        remarks: 'Normal production',
        isVoided: false,
        voidReason: '',
        voidedBy: '',
        createdBy: 'user-1',
        createdByName: 'Staff',
        updatedBy: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'APPROVED',
      },
    ],
    mortalityEntries: [
      {
        id: 'mort-1',
        farmId: mockFarm.farmId,
        transactionDate: '2026-01-10',
        timeOfDay: 'morning',
        batchId: 'b-1',
        batchCodeSnapshot: 'PEN-1-260101',
        penId: 'pen-1',
        penNameSnapshot: 'Pen 1',
        birdAgeDaysAtTransaction: 131,
        mortalityCount: 1,
        reasonCategory: 'Heat Stress',
        reasonDetail: '',
        remarks: '',
        isVoided: false,
        voidReason: '',
        voidedBy: '',
        createdBy: 'user-1',
        createdByName: 'Staff',
        updatedBy: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    feedPurchases: [],
    consumptions: [],
    medicationLogs: [],
    environmentLogs: [],
    sales: [],
    farmPurchases: [],
    carePlans: [],
    carePlanItems: [],
    farmReminders: [],
  });

  assert.ok(isSqliteFile(exportResult.dbBytes), 'Export must be a valid SQLite file');
  assert.ok(exportResult.zipBytes.length > 5000, 'Export ZIP must contain data');
  assert.ok(exportResult.fileNameDb.includes('Export'));
  assert.equal(exportResult.recordCounts['batches'], 1);
  assert.equal(exportResult.recordCounts['egg_production'], 1);
  assert.equal(exportResult.recordCounts['mortality_records'], 1);

  // Re-open and verify querying external SQLite tool capability
  const SQL = await getSqlInstance();
  const db = new SQL.Database(exportResult.dbBytes);
  try {
    const metaRes = db.exec("SELECT value FROM _template_metadata WHERE key = 'farm_id';");
    assert.equal(metaRes[0].values[0][0], mockFarm.farmId);

    const bRes = db.exec("SELECT batch_code, initial_count FROM batches;");
    assert.equal(bRes[0].values[0][0], 'PEN-1-260101');
    assert.equal(bRes[0].values[0][1], 1200);

    const pRes = db.exec("SELECT intact_eggs, total_eggs FROM egg_production;");
    assert.equal(pRes[0].values[0][0], 1060);
    assert.equal(pRes[0].values[0][1], 1067);
  } finally {
    db.close();
  }
});
