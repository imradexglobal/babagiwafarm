import React, { useMemo, useState } from 'react';
import { BookOpen, Calendar, Edit2, PauseCircle, Plus, Search, X } from 'lucide-react';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { importPoultryCareTemplate, saveCareInformation, seedStarterCareInformation, setCareInformationStatus } from '../services/careInformationService.ts';
import type { CareCategory, CareInformation, FarmMember, ReminderType, RecurrenceUnit } from '../types/farm.ts';
import type { CareInformationDraft } from '../services/careInformationService.ts';
import { POULTRY_CARE_TEMPLATES, previewTemplateDates, type PoultryCareTemplateId } from '../domain/careTemplates.ts';

const CATEGORY_OPTIONS: { value: CareCategory; label: string }[] = [
  { value: 'vaccination', label: 'Vaccination' },
  { value: 'medication_health', label: 'Medication & health' },
  { value: 'cleaning_sanitation', label: 'Cleaning & sanitation' },
  { value: 'water_management', label: 'Water management' },
  { value: 'animal_management', label: 'Animal management' },
  { value: 'facility_maintenance', label: 'Equipment & facilities' },
  { value: 'biosecurity', label: 'Biosecurity' },
  { value: 'monitoring_production', label: 'Monitoring & production' },
  { value: 'general', label: 'General farm management' },
];
const REMINDER_OPTIONS: { value: ReminderType; label: string }[] = [
  { value: 'vaccination', label: 'Vaccination' }, { value: 'medication', label: 'Medication / health' },
  { value: 'cleaning', label: 'Cleaning' }, { value: 'water_management', label: 'Water management' },
  { value: 'animal_management', label: 'Animal management' }, { value: 'maintenance', label: 'Maintenance' },
  { value: 'biosecurity', label: 'Biosecurity' }, { value: 'monitoring', label: 'Monitoring' }, { value: 'general', label: 'General' },
];
const emptyDraft = (): CareInformationDraft => ({ title: '', category: 'general', reminderType: 'general', animalApplicability: 'all', animalTypes: [], productionTypes: [], productionStages: [], instructions: '', notes: '', autoIncludeGeneral: false, requiresVeterinaryApproval: false, requiresApproval: false, defaultOffsetDays: 0, defaultIntervalUnit: 'once', defaultIntervalValue: 1 });
const splitList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

export interface CareInformationLibraryProps {
  farmId: string;
  member: FarmMember;
  records: CareInformation[];
  canEdit: boolean;
  onFeedback: (feedback: { type: 'success' | 'error'; text: string }) => void;
}

export const CareInformationLibrary: React.FC<CareInformationLibraryProps> = ({ farmId, member, records, canEdit, onFeedback }) => {
  const [queryText, setQueryText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [animalFilter, setAnimalFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [editing, setEditing] = useState<CareInformation | null>(null);
  const [draft, setDraft] = useState<CareInformationDraft>(emptyDraft());
  const [animalText, setAnimalText] = useState('');
  const [productionText, setProductionText] = useState('');
  const [stageText, setStageText] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<PoultryCareTemplateId>('layer_pullet_0_18');
  const [plannedReferenceDate, setPlannedReferenceDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  const animalOptions = useMemo(() => [...new Set(records.flatMap((record) => record.animalTypes))].sort(), [records]);
  const visibleRecords = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    return records.filter((record) => {
      if (categoryFilter !== 'all' && record.category !== categoryFilter) return false;
      if (activeFilter !== 'all' && record.status !== activeFilter) return false;
      if (animalFilter === 'ALL/GENERAL' && record.animalApplicability !== 'all') return false;
      if (animalFilter !== 'all' && animalFilter !== 'ALL/GENERAL' && !record.animalTypes.includes(animalFilter)) return false;
      return !needle || [record.title, record.instructions, record.notes, ...record.animalTypes, ...record.productionTypes].join(' ').toLowerCase().includes(needle);
    });
  }, [records, queryText, categoryFilter, animalFilter, activeFilter]);

  const beginCreate = () => {
    setEditing(null); setDraft(emptyDraft()); setAnimalText(''); setProductionText(''); setStageText(''); setError(''); setFormOpen(true);
  };
  const beginEdit = (record: CareInformation) => {
    setEditing(record);
    setDraft({ title: record.title, category: record.category, reminderType: record.reminderType, animalApplicability: record.animalApplicability, animalTypes: record.animalTypes, productionTypes: record.productionTypes, productionStages: record.productionStages, instructions: record.instructions, notes: record.notes, autoIncludeGeneral: record.autoIncludeGeneral, requiresVeterinaryApproval: record.requiresVeterinaryApproval, requiresApproval: record.requiresApproval, defaultOffsetDays: record.defaultOffsetDays, defaultIntervalUnit: record.defaultIntervalUnit, defaultIntervalValue: record.defaultIntervalValue });
    setAnimalText(record.animalTypes.join(', ')); setProductionText(record.productionTypes.join(', ')); setStageText(record.productionStages.join(', ')); setError(''); setFormOpen(true);
  };
  const closeForm = () => { setFormOpen(false); setEditing(null); setError(''); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await saveCareInformation({ farmId, actorUid: member.uid, actorName: member.displayName, existing: editing || undefined, draft: { ...draft, animalTypes: splitList(animalText), productionTypes: splitList(productionText), productionStages: splitList(stageText) } });
      closeForm(); onFeedback({ type: 'success', text: `Saved care activity “${draft.title.trim()}”.` });
    } catch (cause) { setError(formatUserFriendlyError(cause)); } finally { setBusy(false); }
  };
  const seed = async () => {
    setBusy(true);
    try { const count = await seedStarterCareInformation({ farmId, actorUid: member.uid, actorName: member.displayName }); onFeedback({ type: 'success', text: count ? `Added ${count} editable starter reference activities. Existing entries were left unchanged.` : 'Starter references are already present; no records were overwritten.' }); }
    catch (cause) { onFeedback({ type: 'error', text: formatUserFriendlyError(cause) }); }
    finally { setBusy(false); }
  };
  const importTemplate = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await importPoultryCareTemplate({ farmId, templateId: selectedTemplateId, actorUid: member.uid, actorName: member.displayName });
      setTemplateDialogOpen(false);
      const message = result.tasksAdded || result.activitiesAdded
        ? `Imported ${POULTRY_CARE_TEMPLATES.find((template) => template.id === selectedTemplateId)?.name}: added ${result.tasksAdded} plan task(s) and ${result.activitiesAdded} reusable activity/activities. Existing entries were preserved.`
        : 'This template is already present; no tasks or activities needed to be added.';
      onFeedback({ type: 'success', text: message });
    } catch (cause) { setError(formatUserFriendlyError(cause)); }
    finally { setBusy(false); }
  };
  const toggleStatus = async (record: CareInformation) => {
    setBusy(true);
    try { const status = record.status === 'active' ? 'inactive' : 'active'; await setCareInformationStatus({ farmId, record, status, actorUid: member.uid, actorName: member.displayName }); onFeedback({ type: 'success', text: `${record.title} is now ${status}. Existing scheduled records are unchanged.` }); }
    catch (cause) { onFeedback({ type: 'error', text: formatUserFriendlyError(cause) }); }
    finally { setBusy(false); }
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block text-xs font-medium text-slate-700"><span>{label}</span><span className="mt-1 block">{children}</span></label>;
  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Care Information Library</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">Reusable farm-care activities with explicit animal/production applicability. Reference medical examples are not prescriptions; use veterinary guidance and local requirements.</p>
        </div>
        {canEdit && <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={seed} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><BookOpen className="h-3.5 w-3.5" />Add starter references</button>
          <button type="button" disabled={busy} onClick={() => { setError(''); setTemplateDialogOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50">Import Template</button>
          <button type="button" onClick={beginCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-900"><Plus className="h-3.5 w-3.5" />New activity</button>
        </div>}
      </div>

      {formOpen && <form onSubmit={save} className="my-4 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">{editing ? 'Edit care activity' : 'Create care activity'}</h3><button type="button" onClick={closeForm} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close editor"><X className="h-4 w-4" /></button></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Activity name"><input required maxLength={140} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputClass} /></Field>
          <Field label="Category"><select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as CareCategory })} className={inputClass}>{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
          <Field label="Activity type"><select value={draft.reminderType} onChange={(e) => setDraft({ ...draft, reminderType: e.target.value as ReminderType })} className={inputClass}>{REMINDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
          <Field label="Animal applicability"><select value={draft.animalApplicability} onChange={(e) => setDraft({ ...draft, animalApplicability: e.target.value as 'specific' | 'all', autoIncludeGeneral: e.target.value === 'all' && draft.autoIncludeGeneral })} className={inputClass}><option value="specific">Specific animal types</option><option value="all">ALL / GENERAL</option></select></Field>
          {draft.animalApplicability === 'specific' && <Field label="Animal types (comma-separated)"><input required value={animalText} onChange={(e) => setAnimalText(e.target.value)} placeholder="Chicken, Goat" className={inputClass} /></Field>}
          <Field label="Production types (optional)"><input value={productionText} onChange={(e) => setProductionText(e.target.value)} placeholder="Layer, Broiler" className={inputClass} /></Field>
          <Field label="Production stages (optional)"><input value={stageText} onChange={(e) => setStageText(e.target.value)} placeholder="Pullet, Grower" className={inputClass} /></Field>
          <Field label="First due offset (days)"><input type="number" min={0} max={2000} value={draft.defaultOffsetDays} onChange={(e) => setDraft({ ...draft, defaultOffsetDays: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label="Default recurrence"><select value={draft.defaultIntervalUnit} onChange={(e) => setDraft({ ...draft, defaultIntervalUnit: e.target.value as RecurrenceUnit })} className={inputClass}>{(['once', 'day', 'week', 'month'] as RecurrenceUnit[]).map((unit) => <option key={unit} value={unit}>{unit === 'once' ? 'One time' : `Every ${unit}`}</option>)}</select></Field>
          {draft.defaultIntervalUnit !== 'once' && <Field label="Recurrence interval"><input type="number" min={1} max={3650} value={draft.defaultIntervalValue} onChange={(e) => setDraft({ ...draft, defaultIntervalValue: Number(e.target.value) })} className={inputClass} /></Field>}
          <Field label="Instructions"><textarea maxLength={500} rows={2} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} className={inputClass} /></Field>
          <Field label="Safety notes"><textarea maxLength={500} rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={inputClass} /></Field>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700">
          {draft.animalApplicability === 'all' && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={draft.autoIncludeGeneral} onChange={(e) => setDraft({ ...draft, autoIncludeGeneral: e.target.checked })} />Allow general inclusion when compatible</label>}
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={draft.requiresVeterinaryApproval} onChange={(e) => setDraft({ ...draft, requiresVeterinaryApproval: e.target.checked, requiresApproval: e.target.checked || draft.requiresApproval })} />Veterinary review required</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={draft.requiresApproval} onChange={(e) => setDraft({ ...draft, requiresApproval: e.target.checked })} />Completion requires approval</label>
        </div>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={closeForm} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">Cancel</button><button type="submit" disabled={busy} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save activity'}</button></div>
      </form>}

      <div className="grid gap-2 border-b border-slate-100 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative"><span className="sr-only">Search care activities</span><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="Search activities" className={`${inputClass} pl-8`} /></label>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={inputClass}><option value="all">All categories</option>{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <select value={animalFilter} onChange={(e) => setAnimalFilter(e.target.value)} className={inputClass}><option value="all">All applicability</option><option value="ALL/GENERAL">ALL / GENERAL</option>{animalOptions.map((animal) => <option key={animal} value={animal}>{animal}</option>)}</select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as 'all' | 'active' | 'inactive')} className={inputClass}><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All statuses</option></select>
      </div>
      {visibleRecords.length === 0 ? <p className="py-6 text-center text-xs text-slate-500">No care-information records match these filters.</p> : <div className="divide-y divide-slate-100">{visibleRecords.map((record) => <article key={record.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-slate-900">{record.title}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{CATEGORY_OPTIONS.find((option) => option.value === record.category)?.label || record.category}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${record.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{record.status}</span></div>
          <p className="mt-1 text-xs text-slate-600">{record.animalApplicability === 'all' ? 'ALL / GENERAL' : record.animalTypes.join(', ')}{record.productionTypes.length ? ` · ${record.productionTypes.join(', ')}` : ''}{record.productionStages.length ? ` · ${record.productionStages.join(', ')}` : ''}</p>
          {(record.instructions || record.notes) && <p className="mt-1 text-xs text-slate-500">{record.instructions || record.notes}{record.requiresVeterinaryApproval ? ' · Veterinary review required' : ''}</p>}
        </div>
        {canEdit && <div className="flex shrink-0 items-center gap-2"><button type="button" disabled={busy} onClick={() => beginEdit(record)} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"><Edit2 className="h-3 w-3" />Edit</button><button type="button" disabled={busy} onClick={() => void toggleStatus(record)} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"><PauseCircle className="h-3 w-3" />{record.status === 'active' ? 'Deactivate' : 'Activate'}</button></div>}
      </article>)}</div>}

      {templateDialogOpen && (() => {
        const selectedTemplate = POULTRY_CARE_TEMPLATES.find((template) => template.id === selectedTemplateId)!;
        const preview = plannedReferenceDate ? previewTemplateDates(selectedTemplate, plannedReferenceDate) : [];
        const firstDate = preview.reduce((earliest, item) => item.date < earliest ? item.date : earliest, preview[0]?.date || plannedReferenceDate);
        const lastDate = preview.reduce((latest, item) => item.date > latest ? item.date : latest, preview[0]?.date || plannedReferenceDate);
        return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setTemplateDialogOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="template-import-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
              <div><h3 id="template-import-title" className="text-base font-semibold text-slate-900">Choose a care-plan template</h3><p className="mt-1 text-xs text-slate-500">Review the schedule before adding it to the reusable care plans.</p></div>
              <button type="button" disabled={busy} onClick={() => setTemplateDialogOpen(false)} aria-label="Close template import" className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {POULTRY_CARE_TEMPLATES.map((template) => <label key={template.id} className={`cursor-pointer rounded-xl border p-3 ${selectedTemplateId === template.id ? 'border-emerald-700 bg-emerald-50/50 ring-1 ring-emerald-700' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className="flex items-start gap-2"><input type="radio" name="care-template" value={template.id} checked={selectedTemplateId === template.id} onChange={() => setSelectedTemplateId(template.id)} className="mt-0.5 accent-emerald-800" /><span><span className="block text-sm font-semibold text-slate-900">{template.name}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{template.description}</span></span></span>
                <span className="mt-3 block text-[11px] font-medium text-slate-600">{template.tasks.length} schedule items, including recurring checks</span>
                <span className="mt-1 block text-[11px] leading-5 text-slate-500">{template.tasks.slice(0, 4).map((task) => task.title).join(' · ')}{template.tasks.length > 4 ? ' · …' : ''}</span>
              </label>)}
            </div>
            <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_1.3fr]">
              <label className="text-xs font-medium text-slate-700"><span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />Planned hatch / day-old placement date</span><input type="date" required value={plannedReferenceDate} onChange={(event) => setPlannedReferenceDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><span className="mt-1 block text-[11px] font-normal text-slate-500">Used for this preview only. The saved template remains age-based and calculates actual reminders from each batch’s hatch/placement dates.</span></label>
              <div className="text-xs text-slate-700"><p className="font-semibold">Preview: {preview.length} plan items</p><p className="mt-1 text-slate-500">The schedule spans {firstDate} to {lastDate}. Recurring items remain recurrence rules in the plan.</p><ul className="mt-2 grid gap-1 sm:grid-cols-2">{preview.slice(0, 8).map((item, index) => <li key={`${item.title}-${index}`} className="truncate"><span className="font-medium">{item.date}</span> · {item.title}</li>)}</ul>{preview.length > 8 && <p className="mt-1 text-slate-500">And {preview.length - 8} more schedule items.</p>}</div>
            </div>
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">Reference schedules only: adjust with a poultry veterinarian and hatchery MDA/product guidance. Conditional treatments require monitoring and veterinary advice; no doses are supplied. Do not combine coccidiosis vaccination with anticoccidial feed medication. No routine antibiotics or prophylactic antimicrobials are included.</p>
            {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-slate-500">Import adds missing tasks and activities only; existing user edits are retained.</p><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { setTemplateDialogOpen(false); setError(''); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700">Cancel</button><button type="button" disabled={busy || !plannedReferenceDate} onClick={() => void importTemplate()} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Importing…' : `Confirm import · ${selectedTemplate.tasks.length} items`}</button></div></div>
          </section>
        </div>;
      })()}
    </section>
  );
};
