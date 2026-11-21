import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POULTRY_CARE_TEMPLATES,
  getPoultryCareTemplate,
  matchTemplateImportEntries,
  normalizeCareActivityIdentity,
  previewTemplateDates,
} from '../src/domain/careTemplates.ts';

const byId = (id: string) => POULTRY_CARE_TEMPLATES.find((template) => template.id === id)!;

test('the three poultry templates expose the intended schedules and remain bounded', () => {
  assert.deepEqual(POULTRY_CARE_TEMPLATES.map((template) => template.name), [
    'Layer 0–18 Weeks', 'Layer 18+ (Laying Phase)', 'Broiler 0–8 Weeks',
  ]);
  assert.deepEqual(POULTRY_CARE_TEMPLATES.map((template) => template.tasks.length), [18, 11, 13]);
  for (const template of POULTRY_CARE_TEMPLATES) {
    assert.ok(template.tasks.every((task) => task.offsetDays >= 0 && task.offsetDays <= template.horizonDays));
    assert.equal(new Set(template.tasks.map((task) => task.key)).size, template.tasks.length);
    assert.ok(template.tasks.every((task) => task.notes.includes('Source: user-provided')));
  }
});

test('core vaccination entries preserve timing, routes and veterinarian review guardrails', () => {
  const pullet = byId('layer_pullet_0_18');
  const broiler = byId('broiler_0_8');
  const pulletMarek = pullet.tasks.find((task) => task.key === 'marek_hatchery')!;
  const broilerMarek = broiler.tasks.find((task) => task.key === 'marek_hatchery')!;
  assert.equal(pulletMarek.offsetDays, 0);
  assert.match(pulletMarek.dosageOrAction, /hatchery/i);
  assert.equal(broilerMarek.offsetDays, 0);
  assert.equal(pullet.tasks.find((task) => task.key === 'nd_primary')?.offsetDays, 3);
  assert.equal(pullet.tasks.find((task) => task.key === 'ibd_first')?.offsetDays, 10);
  assert.equal(pullet.tasks.find((task) => task.key === 'fowl_pox')?.offsetDays, 42);
  assert.equal(pullet.tasks.find((task) => task.key === 'nd_ib_eds_pre_lay')?.offsetDays, 119);
  assert.ok(pullet.tasks.filter((task) => task.category === 'vaccination').every((task) => task.requiresVeterinaryApproval));
});

test('conditional parasite and disease-risk items are monitor-first and no blanket antimicrobials are prescribed', () => {
  for (const template of POULTRY_CARE_TEMPLATES) {
    const coccidiosis = template.tasks.filter((task) => /coccidiosis control/i.test(task.title));
    assert.equal(coccidiosis.length, 1, `${template.name} should express a single mutually exclusive coccidiosis choice`);
    assert.match(coccidiosis[0].notes, /do not use.*together/i);
    assert.ok(coccidiosis[0].conditional);
    const deworm = template.tasks.find((task) => /deworming review/i.test(task.title));
    if (deworm) {
      assert.ok(deworm.conditional);
      assert.match(deworm.notes, /monitor first/i);
      assert.match(deworm.notes, /withdrawal/i);
    }
    assert.ok(!template.tasks.some((task) => /routine antibiotic|antibiotic course|antifungal treatment/i.test(`${task.title} ${task.dosageOrAction}`)));
  }
  const optionalPulletVaccines = byId('layer_pullet_0_18').tasks.filter((task) => ['coryza_1', 'ib_optional', 'salmonella_optional', 'coryza_2'].includes(task.key));
  assert.ok(optionalPulletVaccines.every((task) => task.conditional && task.requiresVeterinaryApproval));
});

test('recurring plan items have explicit bounded occurrence rules', () => {
  for (const template of POULTRY_CARE_TEMPLATES) {
    const recurring = template.tasks.filter((task) => task.intervalUnit !== 'once');
    assert.ok(recurring.length > 0);
    assert.ok(recurring.every((task) => Number.isInteger(task.occurrenceLimit) && (task.occurrenceLimit || 0) > 0));
    assert.ok(recurring.every((task) => Number.isInteger(task.endAgeDays) && (task.endAgeDays || 0) >= task.offsetDays));
  }
  assert.equal(byId('layer_pullet_0_18').tasks.find((task) => task.key === 'daily_flock_check')?.occurrenceLimit, 127);
  assert.equal(byId('broiler_0_8').tasks.find((task) => task.key === 'broiler_weights')?.occurrenceLimit, 8);
});

test('normalized title plus category identity reuses equivalent activities but keeps categories distinct', () => {
  assert.equal(normalizeCareActivityIdentity('  Marek’s  DISEASE vaccine ', 'Vaccination'), normalizeCareActivityIdentity("mareks disease vaccine", 'vaccination'));
  assert.notEqual(normalizeCareActivityIdentity('Newcastle disease vaccine', 'vaccination'), normalizeCareActivityIdentity('Newcastle disease vaccine', 'monitoring_production'));
});

test('template merge plan is a no-op on re-import and reuses existing user-edited activity records', () => {
  const template = getPoultryCareTemplate('broiler_0_8');
  const firstPass = matchTemplateImportEntries({ tasks: template.tasks, existingTasks: [], existingActivities: [] });
  assert.ok(firstPass.every((entry) => !entry.taskAlreadyExists && entry.existingActivity === null));

  const savedActivities = template.tasks.map((task, index) => ({
    id: `custom_activity_${index}`,
    title: task.title,
    category: task.category,
    notes: `User edit ${index}`,
  }));
  const savedTasks = template.tasks.map((task) => ({ title: task.title, category: task.category }));
  const secondPass = matchTemplateImportEntries({ tasks: template.tasks, existingTasks: savedTasks, existingActivities: savedActivities });
  assert.equal(secondPass.length, template.tasks.length);
  assert.ok(secondPass.every((entry) => entry.taskAlreadyExists));
  assert.deepEqual(secondPass.map((entry) => entry.existingActivity?.id), savedActivities.map((activity) => activity.id));
  assert.deepEqual(savedActivities.map((activity) => activity.notes), template.tasks.map((_, index) => `User edit ${index}`));
});

test('date preview applies age offsets to the supplied planned hatch/day-old date', () => {
  const template = getPoultryCareTemplate('layer_pullet_0_18');
  const preview = previewTemplateDates(template, '2026-01-01');
  assert.equal(preview.find((item) => item.title.includes("Marek's disease"))?.date, '2026-01-01');
  assert.equal(preview.find((item) => item.title === 'Fowl pox vaccine')?.date, '2026-02-12');
  assert.equal(preview.length, template.tasks.length);
  assert.throws(() => previewTemplateDates(template, 'not-a-date'), /valid planned hatch/);
});
