import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Edit2,
  Milestone,
  Pill,
  Plus,
  Repeat,
  RotateCcw,
  Syringe,
  X,
  XCircle,
} from 'lucide-react';
import {
  formatBirdAge,
  formatIsoDateDisplay,
  type ResolvedReminderItem,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import {
  REMINDER_TYPE_OPTIONS,
  createFarmReminder,
  updateFarmReminder,
  updateFarmReminderStatus,
} from '../services/remindersService.ts';
import type {
  Farm,
  FarmMember,
  FarmReminder,
  MedicationTreatmentType,
  PoultryBatch,
  RecurrenceUnit,
  ReminderType,
} from '../types/farm.ts';

type StatusViewFilter = 'pending' | 'urgent' | 'all' | 'resolved';

interface DailyRemindersPanelProps {
  farm: Farm;
  member: FarmMember;
  todayStr: string;
  batches: PoultryBatch[];
  activeBatches: PoultryBatch[];
  reminders: FarmReminder[];
  timelineItems: ResolvedReminderItem[];
  batchFilter: string;
  scopedBatchLabel: string;
  canCreateReminder: boolean;
  canEditReminder: boolean;
  canLogMedication: boolean;
  onLogTreatmentFromReminder: (preset: {
    batchId: string;
    treatmentType: MedicationTreatmentType;
    medicationName: string;
    dosage: string;
  }) => void;
  onFeedback: (feedback: { type: 'success' | 'error'; text: string }) => void;
}

const TYPE_META: Record<
  ReminderType,
  { label: string; Icon: React.FC<{ className?: string }> }
> = {
  vaccination: { label: 'Vaccination', Icon: Syringe },
  medication: { label: 'Medication', Icon: Pill },
  milestone: { label: 'Batch Milestone', Icon: Milestone },
  feeding: { label: 'Feeding', Icon: Bell },
  maintenance: { label: 'Maintenance', Icon: RotateCcw },
  inspection: { label: 'Inspection', Icon: CheckCircle2 },
  cleaning: { label: 'Cleaning', Icon: RotateCcw },
  water_management: { label: 'Water management', Icon: Calendar },
  animal_management: { label: 'Animal management', Icon: CheckCircle2 },
  biosecurity: { label: 'Biosecurity', Icon: AlertTriangle },
  monitoring: { label: 'Monitoring', Icon: CalendarClock },
  general: { label: 'General care', Icon: Bell },
};

function renderUrgencyLabel(item: ResolvedReminderItem) {
  if (item.urgency === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>
          Completed{item.completedAtDate ? ` · ${formatIsoDateDisplay(item.completedAtDate)}` : ''}
        </span>
      </span>
    );
  }
  if (item.urgency === 'dismissed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        <span>Dismissed</span>
      </span>
    );
  }
  if (item.urgency === 'overdue') {
    const overdueDays = Math.abs(item.daysUntilDue);
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono tabular-nums">
          Overdue by {overdueDays} {overdueDays === 1 ? 'day' : 'days'}
        </span>
      </span>
    );
  }
  if (item.urgency === 'due_today') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>Due Today</span>
      </span>
    );
  }
  if (item.urgency === 'due_soon') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono tabular-nums">
          Due in {item.daysUntilDue} {item.daysUntilDue === 1 ? 'day' : 'days'}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className="font-mono tabular-nums">
        In {item.daysUntilDue} {item.daysUntilDue === 1 ? 'day' : 'days'}
      </span>
    </span>
  );
}

export const DailyRemindersPanel: React.FC<DailyRemindersPanelProps> = ({
  farm,
  member,
  todayStr,
  batches,
  activeBatches,
  reminders,
  timelineItems,
  batchFilter,
  scopedBatchLabel,
  canCreateReminder,
  canEditReminder,
  canLogMedication,
  onLogTreatmentFromReminder,
  onFeedback,
}) => {
  const [statusFilter, setStatusFilter] = useState<StatusViewFilter>('pending');
  const [typeFilter, setTypeFilter] = useState<'all' | ReminderType>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Create custom reminder inline drawer
  const [createOpen, setCreateOpen] = useState(false);
  const [formBatchId, setFormBatchId] = useState('');
  const [formType, setFormType] = useState<ReminderType>('vaccination');
  const [formDueDate, setFormDueDate] = useState(todayStr);
  const [formTitle, setFormTitle] = useState('');
  const [formDosage, setFormDosage] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formIntervalUnit, setFormIntervalUnit] = useState<RecurrenceUnit>('once');
  const [formIntervalValue, setFormIntervalValue] = useState('1');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit persisted reminder modal
  const [editingReminder, setEditingReminder] = useState<FarmReminder | null>(null);
  const [editType, setEditType] = useState<ReminderType>('vaccination');
  const [editDueDate, setEditDueDate] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDosage, setEditDosage] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const persistedById = useMemo(() => new Map(reminders.map((r) => [r.id, r])), [reminders]);

  // Filter timeline items based on staff member pen assignments
  const scopedTimelineItems = useMemo(() => {
    if (member.role === 'staff' && member.assignedPenIds && member.assignedPenIds.length > 0) {
      return timelineItems.filter((item) => member.assignedPenIds!.includes(item.penId));
    }
    return timelineItems;
  }, [timelineItems, member]);

  const kpis = useMemo(() => {
    let overdue = 0;
    let dueWeek = 0;
    let upcomingMonth = 0;
    let completed = 0;
    for (const item of scopedTimelineItems) {
      if (item.status === 'completed') {
        completed += 1;
        continue;
      }
      if (item.status !== 'pending') continue;
      if (item.daysUntilDue < 0) overdue += 1;
      else if (item.daysUntilDue <= 7) dueWeek += 1;
      else if (item.daysUntilDue <= 30) upcomingMonth += 1;
    }
    return { overdue, dueWeek, upcomingMonth, completed };
  }, [scopedTimelineItems]);

  const filteredItems = useMemo(() => {
    return scopedTimelineItems.filter((item) => {
      if (typeFilter !== 'all' && item.reminderType !== typeFilter) return false;
      if (statusFilter === 'pending') return item.status === 'pending';
      if (statusFilter === 'urgent') return item.status === 'pending' && item.daysUntilDue <= 14;
      if (statusFilter === 'resolved') {
        return item.status === 'completed' || item.status === 'dismissed';
      }
      return true;
    });
  }, [scopedTimelineItems, statusFilter, typeFilter]);

  const openCreateDrawer = () => {
    const preferredBatch =
      (batchFilter !== 'all' && activeBatches.find((b) => b.id === batchFilter)?.id) ||
      activeBatches[0]?.id ||
      '';
    setFormBatchId(preferredBatch);
    setFormType('vaccination');
    setFormDueDate(todayStr);
    setFormTitle('');
    setFormDosage('');
    setFormNotes('');
    setFormIntervalUnit('once');
    setFormIntervalValue('1');
    setFormError(null);
    setCreateOpen(true);
  };

  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSubmitting(true);
    try {
      const batch = batchById.get(formBatchId);
      if (!batch) throw new Error('Select an active pen batch.');
      await createFarmReminder({
        farmId: farm.farmId,
        batch,
        reminderType: formType,
        title: formTitle,
        dueDate: formDueDate,
        dosageOrAction: formDosage,
        notes: formNotes,
        intervalUnit: formIntervalUnit,
        intervalValue: formIntervalUnit === 'once' ? 1 : Math.max(1, Number(formIntervalValue) || 1),
        timeZone: farm.timezone,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setCreateOpen(false);
      onFeedback({
        type: 'success',
        text: `Scheduled "${formTitle.trim()}" for ${batch.batchCode} (${batch.penNameSnapshot}) on ${formatIsoDateDisplay(formDueDate)}.`,
      });
    } catch (err) {
      setFormError(formatUserFriendlyError(err));
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleTransitionStatus = async (
    item: ResolvedReminderItem,
    nextStatus: 'completed' | 'dismissed' | 'pending'
  ) => {
    setBusyKey(item.key);
    try {
      if (item.persistedId) {
        const persisted = persistedById.get(item.persistedId);
        await updateFarmReminderStatus({
          farmId: farm.farmId,
          reminder: persisted || {
            id: item.persistedId,
            title: item.title,
            batchCodeSnapshot: item.batchCode,
            status: item.status,
          },
          nextStatus,
          completedAtDate: todayStr,
          timeZone: farm.timezone,
          actorUid: member.uid,
          actorName: member.displayName,
        });
      } else {
        const batch = batchById.get(item.batchId);
        if (!batch) throw new Error('Batch record not found.');
        await createFarmReminder({
          farmId: farm.farmId,
          batch,
          reminderType: item.reminderType,
          title: item.title,
          dueDate: item.dueDate,
          milestoneKey: item.milestoneKey,
          targetAgeDays: item.targetAgeDays,
          dosageOrAction: item.dosageOrAction,
          notes: item.notes,
          initialStatus: nextStatus,
          completedAtDate: todayStr,
          timeZone: farm.timezone,
          actorUid: member.uid,
          actorName: member.displayName,
        });
      }
      onFeedback({
        type: 'success',
        text:
          nextStatus === 'completed'
            ? `Marked "${item.title}" (${item.penName}) as completed.`
            : nextStatus === 'dismissed'
            ? `Dismissed "${item.title}" (${item.penName}).`
            : `Reopened "${item.title}" (${item.penName}).`,
      });
    } catch (err) {
      onFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setBusyKey(null);
    }
  };

  const openEditModal = (item: ResolvedReminderItem) => {
    if (!item.persistedId) return;
    const raw = persistedById.get(item.persistedId);
    if (!raw) return;
    setEditError(null);
    setEditingReminder(raw);
    setEditType(raw.reminderType);
    setEditDueDate(raw.dueDate);
    setEditTitle(raw.title);
    setEditDosage(raw.dosageOrAction);
    setEditNotes(raw.notes);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReminder) return;
    setEditError(null);
    setEditSaving(true);
    try {
      const batch = batchById.get(editingReminder.batchId);
      if (!batch) throw new Error('Associated batch record not found.');
      await updateFarmReminder({
        farmId: farm.farmId,
        reminder: editingReminder,
        batch,
        reminderType: editType,
        title: editTitle,
        dueDate: editDueDate,
        dosageOrAction: editDosage,
        notes: editNotes,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setEditingReminder(null);
      onFeedback({ type: 'success', text: 'Reminder updated.' });
    } catch (err) {
      setEditError(formatUserFriendlyError(err));
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4 tabular-nums">
        <div>
          <p className="text-xs text-slate-500">Overdue</p>
          <p
            className={`mt-0.5 font-mono text-lg font-bold ${
              kpis.overdue > 0 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {kpis.overdue}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Due Within 7 Days</p>
          <p
            className={`mt-0.5 font-mono text-lg font-bold ${
              kpis.dueWeek > 0 ? 'text-amber-800' : 'text-slate-900'
            }`}
          >
            {kpis.dueWeek}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Upcoming (8–30d)</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-slate-900">{kpis.upcomingMonth}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Completed</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-emerald-800">{kpis.completed}</p>
        </div>
      </div>

      {/* Controls & Action Header */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-1">
            {(
              [
                { id: 'pending', label: 'Pending' },
                { id: 'urgent', label: 'Due <= 14d' },
                { id: 'resolved', label: 'Completed / Dismissed' },
                { id: 'all', label: 'All' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStatusFilter(opt.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === opt.id
                    ? 'bg-emerald-800 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter reminder category"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | ReminderType)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option value="all">All Categories</option>
            <option value="vaccination">Vaccinations</option>
            <option value="medication">Medications / Deworming</option>
            <option value="milestone">Batch Age Milestones</option>
          </select>
        </div>

        {canCreateReminder && (
          <button
            type="button"
            onClick={() => (createOpen ? setCreateOpen(false) : openCreateDrawer())}
            disabled={activeBatches.length === 0 && !createOpen}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-800 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-900 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {createOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            <span>{createOpen ? 'Cancel' : 'Schedule Custom Reminder'}</span>
          </button>
        )}
      </div>

      {/* Inline Custom Reminder Form */}
      {createOpen && canCreateReminder && (
        <form
          onSubmit={handleCreateReminder}
          className="rounded-xl border border-emerald-800/30 bg-white p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Schedule Vaccination or Pen Reminder
              </h2>
              <p className="text-xs text-slate-500">
                Custom schedules sit alongside the automatic poultry layer vaccination calendar.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Close reminder form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label htmlFor="rem-batch" className="block text-xs font-medium text-slate-700">
                Pen / Batch <span className="text-red-600">*</span>
              </label>
              <select
                id="rem-batch"
                required
                value={formBatchId}
                onChange={(e) => setFormBatchId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Select active batch...</option>
                {activeBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchCode} — {b.penNameSnapshot}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rem-type" className="block text-xs font-medium text-slate-700">
                Category <span className="text-red-600">*</span>
              </label>
              <select
                id="rem-type"
                value={formType}
                onChange={(e) => setFormType(e.target.value as ReminderType)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {REMINDER_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rem-due" className="block text-xs font-medium text-slate-700">
                Due Date <span className="text-red-600">*</span>
              </label>
              <div className="relative mt-1">
                <input
                  id="rem-due"
                  type="date"
                  required
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
                <div className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900">
                  <span>{formDueDate ? formatIsoDateDisplay(formDueDate) : 'Select date'}</span>
                  <Calendar className="h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rem-title" className="block text-xs font-medium text-slate-700">
                Reminder Title <span className="text-red-600">*</span>
              </label>
              <input
                id="rem-title"
                type="text"
                required
                maxLength={140}
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. Monthly Lasota Booster or Litter Change"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="rem-dosage" className="block text-xs font-medium text-slate-700">
                Dosage / Target Action
              </label>
              <input
                id="rem-dosage"
                type="text"
                maxLength={140}
                value={formDosage}
                onChange={(e) => setFormDosage(e.target.value)}
                placeholder="e.g. 100 doses / 200L non-chlorinated water"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="rem-notes" className="block text-xs font-medium text-slate-700">
              Notes / Preparation Instructions
            </label>
            <input
              id="rem-notes"
              type="text"
              maxLength={500}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Optional instructions for pen attendants"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={formSubmitting}
              className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-900 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {formSubmitting ? 'Saving...' : 'Save Reminder'}
            </button>
          </div>
        </form>
      )}

      {/* Reminders List */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Vaccination &amp; Batch Age Milestones
            </h2>
            <p className="text-xs text-slate-500">
              Scope: {scopedBatchLabel} · Standard layer schedule runs automatically from each active
              batch&apos;s age &amp; placement date.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {filteredItems.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Bell className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-700">
              No reminders match the current filter
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {activeBatches.length === 0
                ? 'Place an active poultry batch to activate automatic vaccination and age milestone tracking.'
                : 'Switch status tabs or schedule a custom pen reminder above.'}
            </p>
            {canCreateReminder && activeBatches.length > 0 && !createOpen && (
              <button
                type="button"
                onClick={openCreateDrawer}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Schedule Custom Reminder</span>
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredItems.map((item) => {
              const typeMeta = TYPE_META[item.reminderType];
              const TypeIcon = typeMeta.Icon;
              const isBusy = busyKey === item.key;

              return (
                <div
                  key={item.key}
                  className={`flex flex-col gap-3 px-5 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                    item.status !== 'pending' ? 'bg-slate-50/60' : 'hover:bg-slate-50/70'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {/* Zero-pill quiet unboxed metadata kicker */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800">{item.batchCode}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.penName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-slate-700">
                        <TypeIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span>{typeMeta.label}</span>
                      </span>
                      {item.targetAgeDays !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            Target Age: {formatBirdAge(item.targetAgeDays)}
                          </span>
                        </>
                      )}
                      {item.currentBatchAgeDays !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-slate-400">
                            Now {Math.floor(item.currentBatchAgeDays / 7)}w{' '}
                            {item.currentBatchAgeDays % 7}d
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{item.source === 'standard' ? 'Standard Schedule' : 'Custom'}</span>
                      {(() => {
                        const persisted = item.persistedId ? persistedById.get(item.persistedId) : null;
                        return (
                          <>
                            {persisted?.intervalUnit && persisted.intervalUnit !== 'once' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 border border-indigo-200">
                                  <Repeat className="h-3 w-3" />
                                  Every {persisted.intervalValue || 1} {persisted.intervalUnit}{persisted.intervalValue && persisted.intervalValue > 1 ? 's' : ''}
                                </span>
                              </>
                            )}
                            {persisted?.carePlanId && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800 border border-teal-200">
                                  Care Plan
                                </span>
                              </>
                            )}
                            {persisted?.occurrenceIndex !== undefined && persisted.occurrenceIndex > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  #{persisted.occurrenceIndex + 1}
                                </span>
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    <p
                      className={`text-sm font-semibold ${
                        item.status === 'dismissed'
                          ? 'text-slate-500 line-through'
                          : 'text-slate-900'
                      }`}
                    >
                      {item.title}
                    </p>

                    {(item.dosageOrAction || item.notes) && (
                      <p className="text-xs text-slate-600">
                        {item.dosageOrAction && (
                          <span className="font-medium text-slate-700">{item.dosageOrAction}</span>
                        )}
                        {item.dosageOrAction && item.notes && (
                          <span className="mx-1.5 text-slate-300" aria-hidden="true">
                            |
                          </span>
                        )}
                        {item.notes && <span className="text-slate-500">{item.notes}</span>}
                      </p>
                    )}

                    {item.completedByName && item.status !== 'pending' && (
                      <p className="text-[11px] text-slate-400">
                        Updated by {item.completedByName}
                      </p>
                    )}
                  </div>

                  {/* Right Date / Urgency & Actions */}
                  <div className="flex flex-col gap-2 sm:items-end shrink-0">
                    <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                      <span className="font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        Due {formatIsoDateDisplay(item.dueDate)}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      {renderUrgencyLabel(item)}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.status === 'pending' &&
                        (item.reminderType === 'vaccination' ||
                          item.reminderType === 'medication') &&
                        canLogMedication && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              onLogTreatmentFromReminder({
                                batchId: item.batchId,
                                treatmentType:
                                  item.suggestedTreatmentType ||
                                  (item.reminderType === 'vaccination'
                                    ? 'vaccination'
                                    : 'medication'),
                                medicationName: item.title.slice(0, 120),
                                dosage: item.dosageOrAction.slice(0, 80),
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-700 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <Syringe className="h-3 w-3" />
                            <span>
                              {item.reminderType === 'vaccination'
                                ? 'Log Vaccine'
                                : 'Log Treatment'}
                            </span>
                          </button>
                        )}

                      {item.status === 'pending' && canCreateReminder && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleTransitionStatus(item, 'completed')}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <Check className="h-3 w-3 text-emerald-700" />
                            <span>Mark Done</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleTransitionStatus(item, 'dismissed')}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <span>Dismiss</span>
                          </button>
                        </>
                      )}

                      {item.status !== 'pending' && item.persistedId && canCreateReminder && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleTransitionStatus(item, 'pending')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Reopen</span>
                        </button>
                      )}

                      {item.persistedId && canEditReminder && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => openEditModal(item)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                          title="Edit reminder"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Persisted Reminder Modal */}
      {editingReminder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                Edit Reminder ({editingReminder.batchCodeSnapshot})
              </h2>
              <button
                type="button"
                onClick={() => setEditingReminder(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              {editError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
                >
                  {editError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Category</label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as ReminderType)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {REMINDER_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Due Date</label>
                  <input
                    type="date"
                    required
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Title</label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Dosage / Target Action
                </label>
                <input
                  type="text"
                  maxLength={140}
                  value={editDosage}
                  onChange={(e) => setEditDosage(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Notes</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingReminder(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
                >
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
