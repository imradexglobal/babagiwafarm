import test from 'node:test';
import assert from 'node:assert/strict';
import { expandCareScheduleCandidate, stableCareOccurrenceId } from '../src/domain/careSchedule.ts';
import { computeNextDueDateAfterCompletion } from '../src/domain/calculations.ts';
import type { CareScheduleCandidate } from '../src/domain/careSchedule.ts';

const candidate = (overrides: Partial<CareScheduleCandidate> = {}): CareScheduleCandidate => ({
  source: 'plan',
  sourcePlanId: 'plan_one',
  sourceItemId: 'item_one',
  careInformationId: 'activity_one',
  title: 'Weekly flock weights',
  reminderType: 'monitoring',
  category: 'monitoring_production',
  dosageOrAction: 'Record a representative sample.',
  notes: '',
  offsetDays: 7,
  intervalUnit: 'week',
  intervalValue: 1,
  occurrenceLimit: 3,
  endAgeDays: 21,
  requiresApproval: false,
  requiresVeterinaryApproval: false,
  dueDate: '2026-01-08',
  ...overrides,
});

test('weekly recurrence expands through its configured occurrence limit and end age', () => {
  const occurrences = expandCareScheduleCandidate(candidate());
  assert.deepEqual(occurrences.map((entry) => entry.dueDate), ['2026-01-08', '2026-01-15', '2026-01-22']);
  assert.deepEqual(occurrences.map((entry) => entry.occurrenceIndex), [0, 1, 2]);
  assert.ok(occurrences.every((entry) => entry.parentDueDate === '2026-01-08'));
});

test('end age prevents occurrences beyond the plan horizon even when no explicit count is supplied', () => {
  const occurrences = expandCareScheduleCandidate(candidate({ occurrenceLimit: null, endAgeDays: 21 }));
  assert.deepEqual(occurrences.map((entry) => entry.dueDate), ['2026-01-08', '2026-01-15', '2026-01-22']);
});

test('one-time tasks create exactly one occurrence and unbounded recurring items wait for completion', () => {
  assert.equal(expandCareScheduleCandidate(candidate({ intervalUnit: 'once', occurrenceLimit: 10 })).length, 1);
  const unbounded = expandCareScheduleCandidate(candidate({ occurrenceLimit: null, endAgeDays: null }), 4);
  assert.equal(unbounded.length, 1);
  const bounded = expandCareScheduleCandidate(candidate({ occurrenceLimit: null, endAgeDays: 1000 }), 4);
  const capped = expandCareScheduleCandidate(candidate({ occurrenceLimit: null, endAgeDays: 1000 }), 2);
  assert.equal(bounded.length, 4);
  assert.equal(capped.length, 2);
});

test('monthly recurrences clamp end-of-month dates without cumulative drift', () => {
  const occurrences = expandCareScheduleCandidate(candidate({
    dueDate: '2026-01-31', offsetDays: 31, intervalUnit: 'month', intervalValue: 1,
    occurrenceLimit: 3, endAgeDays: 120,
  }));
  assert.deepEqual(occurrences.map((entry) => entry.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('a late completion starts the next recurring reminder from the completion date', () => {
  assert.equal(
    computeNextDueDateAfterCompletion('2026-01-01', '2026-01-20', 'week', 1),
    '2026-01-27'
  );
});

test('an early completion preserves the original recurring schedule cadence', () => {
  assert.equal(
    computeNextDueDateAfterCompletion('2026-01-20', '2026-01-18', 'week', 1),
    '2026-01-27'
  );
});

test('stable occurrence IDs differ by batch, activity, date, and recurrence index', () => {
  const base = { batchId: 'batch_1', carePlanId: 'plan_one', activityId: 'item_one', dueDate: '2026-01-08', occurrenceIndex: 0 };
  const id = stableCareOccurrenceId(base);
  assert.equal(id, stableCareOccurrenceId(base));
  assert.notEqual(id, stableCareOccurrenceId({ ...base, occurrenceIndex: 1 }));
  assert.notEqual(id, stableCareOccurrenceId({ ...base, dueDate: '2026-01-15' }));
  assert.notEqual(id, stableCareOccurrenceId({ ...base, batchId: 'batch_2' }));
});
