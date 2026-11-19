import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STAFF_PERMISSIONS,
  OWNER_FULL_PERMISSIONS,
  calculateBatchMortalityStats,
  calculateCostPerEgg,
  calculateCostPerKgBodyWeight,
  calculateFeedConversionRatio,
  calculateHenDayRate,
  calculateHenHousedRate,
  calculateBirdAgeDays,
  calculateEggCounts,
  computeConsumptionCostNgn,
  convertFeedToGrams,
  findQualifyingPurchaseForConsumption,
  formatIsoDateDisplay,
  generateAutoBatchCode,
  hasPermission,
  resolveDateRange,
  sanitizeCsvCell,
} from '../src/domain/calculations.ts';
import type { FarmMember, FeedPurchase, MortalityEntry } from '../src/types/farm.ts';
import { normalizeFarmId } from '../src/services/authService.ts';

test('normalizeFarmId uses the farm name as a stable Firestore document ID', () => {
  assert.equal(normalizeFarmId('Babagiwa Farm'), 'babagiwa_farm');
  assert.equal(normalizeFarmId('  Babagiwa   Farm  '), 'babagiwa_farm');
  assert.equal(normalizeFarmId('Babagiwa-Farm Ltd.'), 'babagiwa_farm_ltd');
});

test('poultry KPI calculations return rounded ratios and handle zero denominators', () => {
  assert.equal(calculateHenDayRate(850, 1000), 85);
  assert.equal(calculateHenHousedRate(800, 1000), 80);
  assert.equal(calculateFeedConversionRatio(125, 250, 'broiler'), 0.5);
  assert.equal(calculateFeedConversionRatio(60, 300, 'layer'), 0.2);
  assert.equal(calculateCostPerEgg(250_000, 10_000), 25);
  assert.equal(calculateCostPerKgBodyWeight(1_200_000, 800, 2.5), 600);
  assert.equal(calculateHenDayRate(10, 0), 0);
  assert.equal(calculateCostPerEgg(100, 0), 0);
  assert.equal(calculateCostPerKgBodyWeight(100, 0, 2), 0);
});

test('calculateBirdAgeDays computes age accurately relative to historical transactionDate from hatchDate', () => {
  const age = calculateBirdAgeDays({
    hatchDate: '2026-01-01',
    placementDate: '2026-05-01',
    ageAtPlacementDays: 0,
    transactionDate: '2026-06-01',
  });
  // Jan (31) + Feb (28) + Mar (31) + Apr (30) + May (31) = 151 days
  assert.equal(age, 151);
});

test('calculateBirdAgeDays falls back to placementDate + ageAtPlacementDays when hatchDate is empty', () => {
  const age = calculateBirdAgeDays({
    hatchDate: '',
    placementDate: '2026-05-01',
    ageAtPlacementDays: 120,
    transactionDate: '2026-05-11',
  });
  assert.equal(age, 130);
});

test('calculateBirdAgeDays rejects transactionDate earlier than placementDate', () => {
  assert.throws(
    () =>
      calculateBirdAgeDays({
        hatchDate: '',
        placementDate: '2026-05-10',
        ageAtPlacementDays: 100,
        transactionDate: '2026-05-09',
      }),
    /earlier than batch placement date/
  );
});

test('calculateEggCounts computes intact = crates*30 + pieces and total = intact + cracked + damaged', () => {
  const res = calculateEggCounts({
    crates: 12,
    pieces: 14,
    crackedEggs: 5,
    damagedEggs: 2,
  });
  assert.equal(res.intactEggs, 374);
  assert.equal(res.totalEggs, 381);
});

test('calculateEggCounts rejects zero total or negative inputs', () => {
  assert.throws(() =>
    calculateEggCounts({ crates: 0, pieces: 0, crackedEggs: 0, damagedEggs: 0 })
  );
  assert.throws(() =>
    calculateEggCounts({ crates: -1, pieces: 5, crackedEggs: 0, damagedEggs: 0 })
  );
});

test('convertFeedToGrams converts kg and configurable bag weights accurately', () => {
  assert.equal(convertFeedToGrams(10, 'kg', 25), 10_000);
  assert.equal(convertFeedToGrams(4, 'bags', 25), 100_000);
  assert.equal(convertFeedToGrams(2.5, 'bags', 50), 125_000);
  assert.throws(() => convertFeedToGrams(0, 'kg', 25));
  assert.throws(() => convertFeedToGrams(-3, 'bags', 25));
});

test('findQualifyingPurchaseForConsumption never uses a future purchase and picks latest <= consumptionDate', () => {
  const makePurchase = (
    id: string,
    date: string,
    totalCostNgn: number,
    grams: number,
    isVoided = false
  ): FeedPurchase => ({
    id,
    farmId: 'farm_1',
    transactionDate: date,
    feedItemId: 'feed_layer',
    feedTypeSnapshot: 'Layer Mash',
    brandSnapshot: 'Topfeeds',
    enteredQuantity: grams / 25000,
    enteredUnit: 'bags',
    bagWeightKgSnapshot: 25,
    standardizedGrams: grams,
    unitPurchasePriceNgn: totalCostNgn / (grams / 25000),
    totalCostNgn,
    unitCostPerGramNgn: totalCostNgn / grams,
    supplier: '',
    reference: '',
    remarks: '',
    isVoided,
    voidReason: '',
    voidedBy: '',
    createdBy: 'u1',
    createdByName: 'Owner',
    updatedBy: 'u1',
    createdAt: { seconds: 100 },
    updatedAt: { seconds: 100 },
  });

  const purchases = [
    makePurchase('p_old', '2026-10-01', 100_000, 250_000), // 0.40/g
    makePurchase('p_mid', '2026-10-15', 125_000, 250_000), // 0.50/g
    makePurchase('p_void', '2026-10-16', 250_000, 250_000, true), // voided -> must ignore
    makePurchase('p_future', '2026-10-25', 200_000, 250_000), // 0.80/g -> future relative to Oct 20
  ];

  // Consumption on Oct 20 must pick p_mid (Oct 15), NOT p_future (Oct 25) and NOT p_void
  const matchOct20 = findQualifyingPurchaseForConsumption(purchases, 'feed_layer', '2026-10-20');
  assert.ok(matchOct20);
  assert.equal(matchOct20.purchaseId, 'p_mid');
  assert.equal(matchOct20.unitCostPerGramNgn, 0.5);
  assert.equal(computeConsumptionCostNgn(50_000, matchOct20.unitCostPerGramNgn), 25_000);

  // Consumption on Oct 10 must pick p_old (Oct 01)
  const matchOct10 = findQualifyingPurchaseForConsumption(purchases, 'feed_layer', '2026-10-10');
  assert.ok(matchOct10);
  assert.equal(matchOct10.purchaseId, 'p_old');

  // Consumption before any purchase returns null
  const matchTooEarly = findQualifyingPurchaseForConsumption(purchases, 'feed_layer', '2026-09-20');
  assert.equal(matchTooEarly, null);
});

test('hasPermission enforces granular permissions and ignores jobTitle', () => {
  const staff: FarmMember = {
    uid: 'u_staff',
    farmId: 'f1',
    email: 'staff@example.com',
    displayName: 'Staff User',
    jobTitle: 'General Farm Manager', // Descriptive only; must NOT grant owner/override permissions!
    role: 'staff',
    status: 'active',
    permissions: DEFAULT_STAFF_PERMISSIONS,
    createdBy: 'u_owner',
    createdAt: null,
    updatedAt: null,
  };

  assert.equal(hasPermission(staff, 'production', 'create'), true);
  assert.equal(hasPermission(staff, 'production', 'edit'), false);
  assert.equal(hasPermission(staff, 'production', 'delete'), false);
  assert.equal(hasPermission(staff, 'sales', 'create'), true);
  assert.equal(hasPermission(staff, 'sales', 'overridePrice'), false);
  assert.equal(hasPermission(staff, 'members', 'manage'), false);

  const inactiveStaff: FarmMember = { ...staff, status: 'inactive' };
  assert.equal(hasPermission(inactiveStaff, 'production', 'create'), false);

  const owner: FarmMember = {
    ...staff,
    uid: 'u_owner',
    role: 'owner',
    permissions: OWNER_FULL_PERMISSIONS,
  };
  assert.equal(hasPermission(owner, 'sales', 'overridePrice'), true);
  assert.equal(hasPermission(owner, 'members', 'manage'), true);
});

test('resolveDateRange respects Africa/Lagos timezone boundaries and all presets', () => {
  // 2026-11-14T23:30:00Z is already 2026-11-15T00:30:00 in Africa/Lagos (UTC+1)
  const ref = new Date('2026-11-14T23:30:00Z');
  const todayLagos = resolveDateRange('today', 'Africa/Lagos', undefined, undefined, ref);
  assert.deepEqual(todayLagos, { startDate: '2026-11-15', endDate: '2026-11-15' });

  const yesterdayLagos = resolveDateRange('yesterday', 'Africa/Lagos', undefined, undefined, ref);
  assert.deepEqual(yesterdayLagos, { startDate: '2026-11-14', endDate: '2026-11-14' });

  const monthLagos = resolveDateRange('month', 'Africa/Lagos', undefined, undefined, ref);
  assert.deepEqual(monthLagos, { startDate: '2026-11-01', endDate: '2026-11-15' });

  // Inclusive 30-day window ending 2026-11-15 starts 2026-10-17
  const last30Lagos = resolveDateRange('last30Days', 'Africa/Lagos', undefined, undefined, ref);
  assert.deepEqual(last30Lagos, { startDate: '2026-10-17', endDate: '2026-11-15' });

  const ytdLagos = resolveDateRange('ytd', 'Africa/Lagos', undefined, undefined, ref);
  assert.deepEqual(ytdLagos, { startDate: '2026-01-01', endDate: '2026-11-15' });
});

test('sanitizeCsvCell neutralizes spreadsheet formula injection', () => {
  assert.equal(sanitizeCsvCell('=SUM(A1:A5)'), `"'=SUM(A1:A5)"`);
  assert.equal(sanitizeCsvCell('Normal "Text"'), `"Normal ""Text"""`);
});

test('formatIsoDateDisplay formats ISO dates as dd mmm, yyyy', () => {
  assert.equal(formatIsoDateDisplay('2026-11-14'), '14 Nov, 2026');
  assert.equal(formatIsoDateDisplay('2026-01-05'), '05 Jan, 2026');
});

test('generateAutoBatchCode builds PEN-1-yymmdd and resolves collisions', () => {
  assert.equal(generateAutoBatchCode('PEN-1', '2026-11-14', []), 'PEN-1-261114');
  assert.equal(generateAutoBatchCode('pen 2', '2026-01-05', []), 'PEN-2-260105');
  assert.equal(
    generateAutoBatchCode('PEN-1', '2026-11-14', ['PEN-1-261114', 'PEN-1-261114-2']),
    'PEN-1-261114-3'
  );
});

test('calculateBatchMortalityStats computes surviving birds, mortality %, survival %, and excludes voided entries', () => {
  const makeEntry = (
    id: string,
    batchId: string,
    mortalityCount: number,
    isVoided = false
  ): MortalityEntry => ({
    id,
    farmId: 'farm_1',
    transactionDate: '2026-11-14',
    timeOfDay: 'morning',
    batchId,
    batchCodeSnapshot: 'PEN-1-261101',
    penId: 'pen_1',
    penNameSnapshot: 'Pen 1',
    birdAgeDaysAtTransaction: 130,
    mortalityCount,
    reasonCategory: 'Heat Stress',
    reasonDetail: '',
    remarks: '',
    isVoided,
    voidReason: isVoided ? 'Mistake' : '',
    voidedBy: isVoided ? 'u1' : '',
    createdBy: 'u1',
    createdByName: 'Owner',
    updatedBy: 'u1',
    createdAt: null,
    updatedAt: null,
  });

  const stats = calculateBatchMortalityStats({ id: 'b1', initialCount: 1000 }, [
    makeEntry('m1', 'b1', 12),
    makeEntry('m2', 'b1', 3),
    makeEntry('m3', 'b1', 50, true), // voided: must be excluded
    makeEntry('m4', 'b2', 20), // different batch: must be excluded
  ]);

  assert.equal(stats.initialCount, 1000);
  assert.equal(stats.totalLosses, 15);
  assert.equal(stats.survivingBirds, 985);
  assert.equal(stats.mortalityRatePct, 1.5);
  assert.equal(stats.survivalRatePct, 98.5);
  assert.equal(stats.entryCount, 2);
});

test('calculateBatchFinancialSummaries computes direct + pooled egg sales vs feed + direct expenses per batch', async () => {
  const { calculateBatchFinancialSummaries } = await import('../src/domain/calculations.ts');

  const batches = [
    { id: 'b1' },
    { id: 'b2' },
  ];

  // b1 produces 600 eggs (60%), b2 produces 400 eggs (40%); voided 500 eggs ignored
  const production = [
    { batchId: 'b1', totalEggs: 600, isVoided: false },
    { batchId: 'b2', totalEggs: 400, isVoided: false },
    { batchId: 'b1', totalEggs: 500, isVoided: true },
  ] as unknown as Parameters<typeof calculateBatchFinancialSummaries>[0]['production'];

  // b1 direct sale 20,000; pooled unassigned sale 100,000 (split 60k / 40k); voided ignored
  const sales = [
    { batchId: 'b1', totalAmountNgn: 20_000, isVoided: false },
    { batchId: '', totalAmountNgn: 100_000, isVoided: false },
    { batchId: 'b2', totalAmountNgn: 50_000, isVoided: true },
  ] as unknown as Parameters<typeof calculateBatchFinancialSummaries>[0]['sales'];

  // feed consumption: b1 30,000; b2 45,000; voided ignored
  const consumptions = [
    { batchId: 'b1', totalCostNgn: 30_000, isVoided: false },
    { batchId: 'b2', totalCostNgn: 45_000, isVoided: false },
    { batchId: 'b1', totalCostNgn: 10_000, isVoided: true },
  ] as unknown as Parameters<typeof calculateBatchFinancialSummaries>[0]['consumptions'];

  // farm purchases: b1 5,000 medication; unallocated '' 12,000 ignored in direct batch expense; voided ignored
  const farmPurchases = [
    { batchId: 'b1', totalCostNgn: 5_000, isVoided: false },
    { batchId: '', totalCostNgn: 12_000, isVoided: false },
    { batchId: 'b2', totalCostNgn: 8_000, isVoided: true },
  ] as unknown as Parameters<typeof calculateBatchFinancialSummaries>[0]['farmPurchases'];

  const summaries = calculateBatchFinancialSummaries({
    batches: batches as Parameters<typeof calculateBatchFinancialSummaries>[0]['batches'],
    production,
    consumptions,
    sales,
    farmPurchases,
  });

  const s1 = summaries.get('b1')!;
  assert.equal(s1.eggsProduced, 600);
  assert.equal(s1.directSalesRevenueNgn, 20_000);
  assert.equal(s1.pooledSalesRevenueNgn, 60_000);
  assert.equal(s1.totalRevenueNgn, 80_000);
  assert.equal(s1.feedExpenseNgn, 30_000);
  assert.equal(s1.directOtherExpenseNgn, 5_000);
  assert.equal(s1.totalExpenseNgn, 35_000);
  assert.equal(s1.netProfitNgn, 45_000);
  assert.equal(s1.profitMarginPct, 56.25);

  const s2 = summaries.get('b2')!;
  assert.equal(s2.eggsProduced, 400);
  assert.equal(s2.directSalesRevenueNgn, 0);
  assert.equal(s2.pooledSalesRevenueNgn, 40_000);
  assert.equal(s2.totalRevenueNgn, 40_000);
  assert.equal(s2.feedExpenseNgn, 45_000);
  assert.equal(s2.directOtherExpenseNgn, 0);
  assert.equal(s2.totalExpenseNgn, 45_000);
  assert.equal(s2.netProfitNgn, -5_000);
  assert.equal(s2.profitMarginPct, -12.5);
});

test('buildLast7DaysProductionAndFeedTrends builds chronological 7-day window, zero-fills gaps, excludes voided and out-of-range records, and respects batchId', async () => {
  const { buildLast7DaysProductionAndFeedTrends } = await import('../src/domain/calculations.ts');

  const production = [
    {
      transactionDate: '2026-11-07', // 8 days before 2026-11-14 -> out of range
      batchId: 'b1',
      intactEggs: 300,
      crackedEggs: 5,
      damagedEggs: 0,
      totalEggs: 305,
      isVoided: false,
    },
    {
      transactionDate: '2026-11-08', // Day 1 of 7
      batchId: 'b1',
      intactEggs: 400,
      crackedEggs: 10,
      damagedEggs: 5,
      totalEggs: 415,
      isVoided: false,
    },
    {
      transactionDate: '2026-11-08', // Same day, different batch
      batchId: 'b2',
      intactEggs: 200,
      crackedEggs: 0,
      damagedEggs: 0,
      totalEggs: 200,
      isVoided: false,
    },
    {
      transactionDate: '2026-11-10', // Voided -> must be ignored
      batchId: 'b1',
      intactEggs: 999,
      crackedEggs: 0,
      damagedEggs: 0,
      totalEggs: 999,
      isVoided: true,
    },
    {
      transactionDate: '2026-11-14', // Today (Day 7)
      batchId: 'b1',
      intactEggs: 500,
      crackedEggs: 8,
      damagedEggs: 2,
      totalEggs: 510,
      isVoided: false,
    },
  ];

  const consumptions = [
    {
      transactionDate: '2026-11-08',
      batchId: 'b1',
      standardizedGrams: 50_000, // 50 kg
      totalCostNgn: 42_500,
      isVoided: false,
    },
    {
      transactionDate: '2026-11-11',
      batchId: 'b2',
      standardizedGrams: 25_000, // 25 kg
      totalCostNgn: 21_250,
      isVoided: false,
    },
    {
      transactionDate: '2026-11-14',
      batchId: 'b1',
      standardizedGrams: 51_000, // 51 kg
      totalCostNgn: 43_350,
      isVoided: false,
    },
    {
      transactionDate: '2026-11-14', // Voided -> ignored
      batchId: 'b1',
      standardizedGrams: 100_000,
      totalCostNgn: 85_000,
      isVoided: true,
    },
  ];

  const allBatches = buildLast7DaysProductionAndFeedTrends({
    todayDateStr: '2026-11-14',
    production,
    consumptions,
    batchId: 'all',
  });

  assert.equal(allBatches.length, 7);
  assert.equal(allBatches[0].date, '2026-11-08');
  assert.equal(allBatches[0].shortDateLabel, '08 Nov');
  assert.equal(allBatches[6].date, '2026-11-14');

  // Day 1 (2026-11-08): 415 + 200 = 615 eggs, 50kg feed
  assert.equal(allBatches[0].totalEggs, 615);
  assert.equal(allBatches[0].intactEggs, 600);
  assert.equal(allBatches[0].crackedOrDamagedEggs, 15);
  assert.equal(allBatches[0].eggEntryCount, 2);
  assert.equal(allBatches[0].feedKg, 50);

  // Day 3 (2026-11-10): voided entry excluded -> 0 eggs, 0 feed
  assert.equal(allBatches[2].date, '2026-11-10');
  assert.equal(allBatches[2].totalEggs, 0);
  assert.equal(allBatches[2].feedKg, 0);

  // Day 4 (2026-11-11): 0 eggs, 25kg feed from b2
  assert.equal(allBatches[3].date, '2026-11-11');
  assert.equal(allBatches[3].feedKg, 25);
  assert.equal(allBatches[3].feedGramsPerEgg, null);

  // Day 7 (2026-11-14): 510 eggs, 51kg feed -> 100.0 g/egg
  assert.equal(allBatches[6].totalEggs, 510);
  assert.equal(allBatches[6].feedKg, 51);
  assert.equal(allBatches[6].feedGramsPerEgg, 100);

  // Scoped to b1 only: excludes b2's 200 eggs on Nov 08 and 25kg feed on Nov 11
  const b1Only = buildLast7DaysProductionAndFeedTrends({
    todayDateStr: '2026-11-14',
    production,
    consumptions,
    batchId: 'b1',
  });
  assert.equal(b1Only[0].totalEggs, 415);
  assert.equal(b1Only[3].feedKg, 0);
});

test('resolveFirebaseSyncState prioritizes offline, then syncing states, then synced', async () => {
  const {
    beginFirebaseSync,
    getSyncTrackerState,
    isOfflineFirestoreError,
    resolveFirebaseSyncState,
  } = await import('../src/lib/firebaseSync.ts');

  const base = {
    isOnline: true,
    fromCache: false,
    hasPendingWrites: false,
    activeOperations: 0,
    waitingForPendingWrites: false,
    serverUnreachable: false,
  };

  assert.equal(resolveFirebaseSyncState(base), 'synced');
  assert.equal(resolveFirebaseSyncState({ ...base, isOnline: false }), 'offline');
  assert.equal(resolveFirebaseSyncState({ ...base, isOnline: false, hasPendingWrites: true }), 'offline');
  assert.equal(resolveFirebaseSyncState({ ...base, serverUnreachable: true }), 'offline');
  assert.equal(resolveFirebaseSyncState({ ...base, fromCache: true }), 'syncing');
  assert.equal(resolveFirebaseSyncState({ ...base, hasPendingWrites: true }), 'syncing');
  assert.equal(resolveFirebaseSyncState({ ...base, waitingForPendingWrites: true }), 'syncing');
  assert.equal(resolveFirebaseSyncState({ ...base, activeOperations: 1 }), 'syncing');

  assert.equal(isOfflineFirestoreError({ code: 'unavailable', message: 'Network unavailable' }), true);
  assert.equal(
    isOfflineFirestoreError(new Error('Failed to get document because the client is offline.')),
    true
  );
  assert.equal(isOfflineFirestoreError(new Error('Missing or insufficient permissions.')), false);

  const end = beginFirebaseSync();
  assert.equal(getSyncTrackerState().activeOperations, 1);
  end();
  end(); // idempotent cleanup
  assert.equal(getSyncTrackerState().activeOperations, 0);
});

test('buildBatchRemindersTimeline computes standard poultry milestones, skips pre-placement chick milestones, deduplicates persisted ones, and merges custom reminders', async () => {
  const { buildBatchRemindersTimeline } = await import('../src/domain/calculations.ts');

  const baseBatch = {
    farmId: 'farm_1',
    penId: 'pen_1',
    penNameSnapshot: 'Pen 1',
    birdType: 'Layers',
    breed: 'ISA Brown',
    source: 'Hatchery',
    hatchDate: '',
    initialCount: 500,
    maleCount: 0,
    femaleCount: 500,
    remarks: '',
    createdBy: 'u1',
    createdByName: 'Owner',
    updatedBy: 'u1',
    createdAt: null,
    updatedAt: null,
  };

  // Batch 1: placed 2026-11-01 at 0 days old -> on 2026-11-15 age is 14 days
  // Day 7 Lasota -> due 2026-11-08 (overdue by -7d)
  // Day 14 Gumboro -> due 2026-11-15 (due_today, 0d)
  // Day 21 Lasota Booster -> due 2026-11-22 (due_soon, +7d)
  const b1 = {
    ...baseBatch,
    id: 'b1',
    batchCode: 'PEN-1-261101',
    ageAtPlacementDays: 0,
    placementDate: '2026-11-01',
    status: 'active' as const,
  };

  // Batch 2: Point-of-Lay pullets placed 2026-11-10 at 112 days old -> on 2026-11-15 age is 117 days
  // Day 7..84 chick/grower milestones happened BEFORE 2026-11-10 -> MUST be skipped!
  // Day 112 (due 2026-11-10 >= placementDate) -> overdue (-5d)
  // Day 126 (due 2026-11-24) -> due_soon (+9d)
  const b2 = {
    ...baseBatch,
    id: 'b2',
    penId: 'pen_2',
    penNameSnapshot: 'Pen 2',
    batchCode: 'PEN-2-261110',
    ageAtPlacementDays: 112,
    placementDate: '2026-11-10',
    status: 'active' as const,
  };

  const persisted = [
    {
      id: 'rem_std_7',
      farmId: 'farm_1',
      batchId: 'b1',
      batchCodeSnapshot: 'PEN-1-261101',
      penId: 'pen_1',
      penNameSnapshot: 'Pen 1',
      milestoneKey: 'std_day_7',
      reminderType: 'vaccination' as const,
      title: 'Newcastle Disease (Lasota / B1) — 1st Dose',
      dueDate: '2026-11-08',
      targetAgeDays: 7,
      dosageOrAction: 'Eye drop',
      notes: '',
      status: 'completed' as const,
      completedAtDate: '2026-11-08',
      completedBy: 'u1',
      completedByName: 'Owner',
      createdBy: 'u1',
      createdByName: 'Owner',
      updatedBy: 'u1',
      createdAt: null,
      updatedAt: null,
    },
    {
      id: 'rem_custom_1',
      farmId: 'farm_1',
      batchId: 'b2',
      batchCodeSnapshot: 'PEN-2-261110',
      penId: 'pen_2',
      penNameSnapshot: 'Pen 2',
      milestoneKey: '',
      reminderType: 'medication' as const,
      title: 'Vitamin ADE Stress Pack',
      dueDate: '2026-11-14',
      targetAgeDays: 116,
      dosageOrAction: '1g/2L water',
      notes: 'Post-transfer support',
      status: 'pending' as const,
      completedAtDate: '',
      completedBy: '',
      completedByName: '',
      createdBy: 'u1',
      createdByName: 'Owner',
      updatedBy: 'u1',
      createdAt: null,
      updatedAt: null,
    },
  ];

  const allItems = buildBatchRemindersTimeline({
    todayDateStr: '2026-11-15',
    batches: [b1, b2],
    reminders: persisted,
    batchId: 'all',
  });

  // For b1: std_day_7 appears once as persisted 'completed', NOT duplicated as virtual pending
  const b1Day7 = allItems.filter((i) => i.batchId === 'b1' && i.milestoneKey === 'std_day_7');
  assert.equal(b1Day7.length, 1);
  assert.equal(b1Day7[0].status, 'completed');
  assert.equal(b1Day7[0].persistedId, 'rem_std_7');

  // For b1: std_day_14 is due_today
  const b1Day14 = allItems.find((i) => i.batchId === 'b1' && i.milestoneKey === 'std_day_14');
  assert.ok(b1Day14);
  assert.equal(b1Day14.urgency, 'due_today');
  assert.equal(b1Day14.dueDate, '2026-11-15');
  assert.equal(b1Day14.daysUntilDue, 0);

  // For b1: std_day_21 is due_soon (+7d)
  const b1Day21 = allItems.find((i) => i.batchId === 'b1' && i.milestoneKey === 'std_day_21');
  assert.ok(b1Day21);
  assert.equal(b1Day21.urgency, 'due_soon');
  assert.equal(b1Day21.daysUntilDue, 7);

  // For b2: pre-placement Day 7..84 chick milestones must NOT appear
  const b2Early = allItems.filter(
    (i) => i.batchId === 'b2' && i.source === 'standard' && (i.targetAgeDays ?? 0) < 112
  );
  assert.equal(b2Early.length, 0);

  // Custom pending reminder on b2 is sorted into pending overdue section
  const b2Custom = allItems.find((i) => i.persistedId === 'rem_custom_1');
  assert.ok(b2Custom);
  assert.equal(b2Custom.source, 'custom');
  assert.equal(b2Custom.urgency, 'overdue');
  assert.equal(b2Custom.daysUntilDue, -1);

  // Pending items come before completed items
  const firstCompletedIdx = allItems.findIndex((i) => i.status === 'completed');
  assert.ok(firstCompletedIdx > 0);
  assert.ok(allItems.slice(0, firstCompletedIdx).every((i) => i.status === 'pending'));

  // Scoping to b2 excludes b1
  const b2Only = buildBatchRemindersTimeline({
    todayDateStr: '2026-11-15',
    batches: [b1, b2],
    reminders: persisted,
    batchId: 'b2',
  });
  assert.ok(b2Only.length > 0);
  assert.ok(b2Only.every((i) => i.batchId === 'b2'));
});






test('pending production is excluded from operational financial and trend calculations', async () => {
  const { calculateBatchFinancialSummaries, buildLast7DaysProductionAndFeedTrends } = await import('../src/domain/calculations.ts');
  const production = [
    { batchId: 'b1', totalEggs: 600, isVoided: false, status: 'APPROVED' },
    { batchId: 'b1', totalEggs: 400, isVoided: false, status: 'PENDING' },
  ] as any;
  const summaries = calculateBatchFinancialSummaries({ batches: [{ id: 'b1' }], production, consumptions: [], sales: [] });
  assert.equal(summaries.get('b1')?.eggsProduced, 600);
  const trends = buildLast7DaysProductionAndFeedTrends({
    todayDateStr: '2026-11-15',
    production: [
      { transactionDate: '2026-11-15', batchId: 'b1', intactEggs: 600, crackedEggs: 0, damagedEggs: 0, totalEggs: 600, isVoided: false, status: 'APPROVED' },
      { transactionDate: '2026-11-15', batchId: 'b1', intactEggs: 400, crackedEggs: 0, damagedEggs: 0, totalEggs: 400, isVoided: false, status: 'PENDING' },
    ] as any,
    consumptions: [],
  });
  assert.equal(trends[6].totalEggs, 600);
});

test('approval is a distinct production capability for staff while owners remain unrestricted', () => {
  const staff: FarmMember = {
    uid: 'u_staff', farmId: 'f1', email: 'staff@example.com', displayName: 'Staff', jobTitle: 'Manager', role: 'staff', status: 'active',
    permissions: DEFAULT_STAFF_PERMISSIONS, createdBy: 'u_owner', createdAt: null, updatedAt: null,
  };
  assert.equal(hasPermission(staff, 'production', 'approve'), false);
  assert.equal(hasPermission({ ...staff, permissions: { ...DEFAULT_STAFF_PERMISSIONS, production: { ...DEFAULT_STAFF_PERMISSIONS.production, approve: true } } }, 'production', 'approve'), true);
  assert.equal(hasPermission({ ...staff, role: 'owner' }, 'production', 'approve'), true);
});

test('hasDepartmentAccess correctly enforces department module access', async () => {
  const { hasDepartmentAccess } = await import('../src/domain/calculations.ts');
  const owner: FarmMember = {
    uid: 'u1', farmId: 'f1', email: 'owner@example.com', displayName: 'Owner', jobTitle: 'Owner', role: 'owner', status: 'active',
    permissions: OWNER_FULL_PERMISSIONS, createdBy: 'self', createdAt: null, updatedAt: null,
  };
  assert.equal(hasDepartmentAccess(owner, 'poultry'), true);
  assert.equal(hasDepartmentAccess(owner, 'fishery'), true);
  assert.equal(hasDepartmentAccess(owner, 'crops'), true);

  const poultryStaff: FarmMember = {
    uid: 'u2', farmId: 'f1', email: 'staff@example.com', displayName: 'Staff', jobTitle: 'Attendant', role: 'staff', status: 'active',
    departments: ['poultry'],
    permissions: DEFAULT_STAFF_PERMISSIONS, createdBy: 'u1', createdAt: null, updatedAt: null,
  };
  assert.equal(hasDepartmentAccess(poultryStaff, 'poultry'), true);
  assert.equal(hasDepartmentAccess(poultryStaff, 'fishery'), false);

  const multiStaff: FarmMember = {
    uid: 'u3', farmId: 'f1', email: 'multi@example.com', displayName: 'Multi', jobTitle: 'Supervisor', role: 'staff', status: 'active',
    departments: ['poultry', 'fishery', 'crops'],
    permissions: DEFAULT_STAFF_PERMISSIONS, createdBy: 'u1', createdAt: null, updatedAt: null,
  };
  assert.equal(hasDepartmentAccess(multiStaff, 'poultry'), true);
  assert.equal(hasDepartmentAccess(multiStaff, 'fishery'), true);
  assert.equal(hasDepartmentAccess(multiStaff, 'crops'), true);
  assert.equal(hasDepartmentAccess(multiStaff, 'livestock'), false);

  const generalStaff: FarmMember = {
    uid: 'u4', farmId: 'f1', email: 'gen@example.com', displayName: 'General', jobTitle: 'Admin', role: 'staff', status: 'active',
    departments: ['general'],
    permissions: DEFAULT_STAFF_PERMISSIONS, createdBy: 'u1', createdAt: null, updatedAt: null,
  };
  assert.equal(hasDepartmentAccess(generalStaff, 'poultry'), true);
  assert.equal(hasDepartmentAccess(generalStaff, 'fishery'), true);
});

test('computeNextDueDate and computeDateWithOffset handle intervals accurately', async () => {
  const { computeNextDueDate, computeDateWithOffset } = await import('../src/domain/calculations.ts');
  
  // Day offset
  assert.equal(computeDateWithOffset('2026-06-01', 0), '2026-06-01');
  assert.equal(computeDateWithOffset('2026-06-01', 7), '2026-06-08');
  assert.equal(computeDateWithOffset('2026-06-25', 10), '2026-07-05');

  // Once gives null
  assert.equal(computeNextDueDate('2026-06-01', 'once', 1), null);

  // Daily interval
  assert.equal(computeNextDueDate('2026-06-01', 'day', 1), '2026-06-02');
  assert.equal(computeNextDueDate('2026-06-01', 'day', 3), '2026-06-04');

  // Weekly interval
  assert.equal(computeNextDueDate('2026-06-01', 'week', 1), '2026-06-08');
  assert.equal(computeNextDueDate('2026-06-01', 'week', 2), '2026-06-15');

  // Monthly interval
  assert.equal(computeNextDueDate('2026-06-15', 'month', 1), '2026-07-15');
  assert.equal(computeNextDueDate('2026-06-15', 'month', 2), '2026-08-15');
});
