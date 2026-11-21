import test from 'node:test';
import assert from 'node:assert/strict';
import { getSqlInstance } from '../src/services/sqliteEngine.ts';
import {
  createTemplateDatabase,
  createTemplateZipPackage,
} from '../src/services/templateGenerator.ts';
import {
  validateImportDatabase,
  generateValidationCsvReport,
  ExistingFarmContext,
} from '../src/services/importValidator.ts';
import { createFarmExportDatabase } from '../src/services/exportService.ts';
import type { Farm } from '../src/types/farm.ts';

test('Full E2E Flow: Template -> External Population -> Validation -> Export', async () => {
  // Step 1: Download / Generate Template
  const templateDbBytes = await createTemplateDatabase();
  const templateZip = await createTemplateZipPackage();
  assert.ok(templateDbBytes.length > 0);
  assert.ok(templateZip.zipBytes.length > 0);
  assert.equal(Object.keys(templateZip.tableDocMap).length, 17);

  // Step 2: Simulate external user opening SQLite and populating records
  const SQL = await getSqlInstance();
  const userDb = new SQL.Database(templateDbBytes);

  try {
    // Insert Pen
    userDb.run(`INSERT INTO pens (id, name, code, capacity, sector, notes, status)
                VALUES ('pen-alpha', 'Layer House Alpha', 'PEN-A', 2500, 'poultry', 'Tunnel ventilated', 'active');`);

    // Insert Feed Item
    userDb.run(`INSERT INTO feed_items (id, feed_type, brand, default_bag_weight_kg, notes, status)
                VALUES ('feed-layer-mash', 'Layers Mash Phase 1', 'TopFeed', 25.0, 'High calcium', 'active');`);

    // Insert Batch
    userDb.run(`INSERT INTO batches (id, batch_code, pen_id, bird_type, breed, source, hatch_date, age_at_placement_days, placement_date, initial_count, male_count, female_count, remarks, status)
                VALUES ('batch-layer-01', 'PEN-A-260101', 'pen-alpha', 'Layer', 'ISA Brown', 'Chiwetalu Hatcheries', '2025-09-01', 122, '2026-01-01', 2000, 0, 2000, 'Placed at 16 weeks', 'active');`);

    // Insert Egg Production
    userDb.run(`INSERT INTO egg_production (id, transaction_date, transaction_time, batch_id, pen_id, crates, pieces, intact_eggs, cracked_eggs, damaged_eggs, total_eggs, remarks, status)
                VALUES ('prod-001', '2026-01-10', '08:30', 'batch-layer-01', 'pen-alpha', 50, 15, 1515, 8, 2, 1525, 'High peak production', 'APPROVED');`);

    // Insert Mortality
    userDb.run(`INSERT INTO mortality_records (id, transaction_date, time_of_day, batch_id, pen_id, mortality_count, reason_category, reason_detail, remarks)
                VALUES ('mort-001', '2026-01-10', 'morning', 'batch-layer-01', 'pen-alpha', 1, 'Heat Stress', '', 'Ventilation checked');`);

    // Insert Feed Consumption
    userDb.run(`INSERT INTO feed_consumption (id, transaction_date, transaction_time, batch_id, pen_id, feed_item_id, entered_quantity, entered_unit, bag_weight_kg, total_cost_ngn, remarks)
                VALUES ('cons-001', '2026-01-10', '07:30', 'batch-layer-01', 'pen-alpha', 'feed-layer-mash', 5, 'bags', 25.0, 72500, 'Normal feeding');`);

    // Insert Medication
    userDb.run(`INSERT INTO medication_records (id, transaction_date, time_of_day, transaction_time, batch_id, pen_id, treatment_type, medication_name, dosage, administration_route, remarks)
                VALUES ('med-001', '2026-01-10', 'morning', '09:00', 'batch-layer-01', 'pen-alpha', 'vitamin', 'Vitalyte Stress Pack', '100g in 50L water', 'Drinking Water', 'Electrolytes');`);

    const populatedBytes = userDb.export();

    // Step 3: Validate the populated database
    const farmContext: ExistingFarmContext = {
      farmId: 'farm-123',
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

    const validReport = await validateImportDatabase(populatedBytes, farmContext);
    assert.equal(validReport.isValid, true, 'Populated database must be valid');
    assert.equal(validReport.canProceedWithImport, true, 'Should be able to proceed with import');
    assert.equal(validReport.totalRecords, 7, 'Must detect 7 total records across tables');
    assert.equal(validReport.errorRecords, 0, 'Must have 0 errors');
    assert.equal(validReport.validRecords, 7, 'All 7 records must be valid');

    // Step 4: Validate error detection with corrupted/broken row
    userDb.run(`INSERT INTO egg_production (id, transaction_date, batch_id, pen_id, crates, pieces, intact_eggs)
                VALUES ('prod-bad', 'invalid-date', 'nonexistent-batch-id', 'pen-alpha', -10, 5, 50);`);

    const invalidBytes = userDb.export();
    const invalidReport = await validateImportDatabase(invalidBytes, farmContext);

    assert.equal(invalidReport.isValid, false, 'Corrupted database must be marked invalid');
    assert.equal(invalidReport.canProceedWithImport, false, 'Must block import when errors exist');
    assert.ok(invalidReport.errorRecords > 0, 'Must report error count');

    const csvReport = generateValidationCsvReport(invalidReport);
    assert.ok(csvReport.includes('ERROR'), 'CSV report must contain ERROR rows');
    assert.ok(csvReport.includes('prod-bad'), 'CSV report must mention prod-bad');

    // Step 5: Test Full Database Export
    const mockFarm: Farm = {
      farmId: 'farm-123',
      name: 'Babagiwa Modern Poultry',
      location: 'Zaria Road, Kaduna',
      contactPhone: '+234800000000',
      contactEmail: 'info@babagiwafarm.com',
      currency: 'NGN',
      timezone: 'Africa/Lagos',
      activeSectors: ['poultry'],
      ownerUid: 'owner-1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const exportRes = await createFarmExportDatabase({
      farm: mockFarm,
      pens: [
        {
          id: 'pen-alpha',
          farmId: 'farm-123',
          name: 'Layer House Alpha',
          code: 'PEN-A',
          capacity: 2500,
          sector: 'poultry',
          activeBatchId: 'batch-layer-01',
          notes: '',
          status: 'active',
          createdBy: 'owner-1',
          createdAt: '',
          updatedAt: '',
        },
      ],
      feedItems: [],
      salesUnits: [],
      customers: [],
      vendors: [],
      batches: [
        {
          id: 'batch-layer-01',
          farmId: 'farm-123',
          batchCode: 'PEN-A-260101',
          penId: 'pen-alpha',
          penNameSnapshot: 'Layer House Alpha',
          birdType: 'Layer',
          breed: 'ISA Brown',
          source: 'Chiwetalu',
          hatchDate: '2025-09-01',
          ageAtPlacementDays: 122,
          placementDate: '2026-01-01',
          initialCount: 2000,
          maleCount: 0,
          femaleCount: 2000,
          remarks: '',
          status: 'active',
          createdBy: 'owner-1',
          createdByName: 'Owner',
          updatedBy: 'owner-1',
          createdAt: '',
          updatedAt: '',
        },
      ],
      production: [
        {
          id: 'prod-001',
          farmId: 'farm-123',
          transactionDate: '2026-01-10',
          transactionTime: '08:30',
          batchId: 'batch-layer-01',
          batchCodeSnapshot: 'PEN-A-260101',
          penId: 'pen-alpha',
          penNameSnapshot: 'Layer House Alpha',
          birdAgeDaysAtTransaction: 131,
          crates: 50,
          pieces: 15,
          intactEggs: 1515,
          crackedEggs: 8,
          damagedEggs: 2,
          totalEggs: 1525,
          remarks: 'Peak',
          isVoided: false,
          voidReason: '',
          voidedBy: '',
          createdBy: 'owner-1',
          createdByName: 'Owner',
          updatedBy: 'owner-1',
          createdAt: '',
          updatedAt: '',
          status: 'APPROVED',
        },
      ],
      mortalityEntries: [],
      feedPurchases: [],
      consumptions: [],
      medicationLogs: [],
      environmentLogs: [],
      sales: [],
      farmPurchases: [],
      carePlans: [],
      farmReminders: [],
    });

    assert.ok(exportRes.fileNameDb.startsWith('Babagiwa_Modern_Poultry_Export_'));
    assert.ok(exportRes.fileNameDb.endsWith('.db'));
    assert.equal(exportRes.recordCounts['batches'], 1);
    assert.equal(exportRes.recordCounts['egg_production'], 1);
    assert.equal(exportRes.totalRecords, 3); // 1 pen, 1 batch, 1 production

    // Verify exported database can be queried with standard SQL
    const verifyDb = new SQL.Database(exportRes.dbBytes);
    const metaCheck = verifyDb.exec("SELECT value FROM _template_metadata WHERE key='export_type'");
    assert.equal(metaCheck[0].values[0][0], 'full_export');
    verifyDb.close();
  } finally {
    userDb.close();
  }
});
