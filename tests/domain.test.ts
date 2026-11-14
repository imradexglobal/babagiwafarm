import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STAFF_PERMISSIONS,
  OWNER_FULL_PERMISSIONS,
  calculateBirdAgeDays,
  calculateEggCounts,
  computeConsumptionCostNgn,
  convertFeedToGrams,
  findQualifyingPurchaseForConsumption,
  hasPermission,
  resolveDateRange,
  sanitizeCsvCell,
} from '../src/domain/calculations.ts';
import type { FarmMember, FeedPurchase } from '../src/types/farm.ts';

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
