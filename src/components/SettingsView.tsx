import React, { useState } from 'react';
import { Calendar, Check, ChevronDown, ChevronRight, Clock, Edit2, Layers, Pill, Plus, Repeat, Syringe, Trash2, UserPlus, X } from 'lucide-react';
import {
  DEFAULT_BAG_WEIGHT_KG,
  DEFAULT_STAFF_PERMISSIONS,
  formatDateInTimezone,
  formatNgn,
  hasPermission,
  FARM_JOB_TITLES,
  isFarmOwnerTitle,
  normalizePermissions,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import {
  createCarePlan,
  createCarePlanItem,
  deleteCarePlan,
  deleteCarePlanItem,
  subscribeCarePlanItems,
  updateCarePlan,
  updateCarePlanItem,
} from '../services/carePlanService.ts';
import {
  createFeedItem,
  createPen,
  createSalesUnit,
  createStaffInvite,
  revokeStaffInvite,
  updateFarmProfile,
  updateFeedItem,
  updatePen,
  updateSalesUnit,
  updateStaffMember,
} from '../services/farmSetupService.ts';
import type {
  Farm,
  FarmInvite,
  FarmMember,
  FeedItem,
  Pen,
  PermissionsMatrix,
  CarePlan,
  CarePlanItem,
  DepartmentType,
  RecurrenceUnit,
  ReminderType,
  SalesUnit,
} from '../types/farm.ts';

interface SettingsViewProps {
  farm: Farm;
  member: FarmMember;
  pens: Pen[];
  feedItems: FeedItem[];
  salesUnits: SalesUnit[];
  members: FarmMember[];
  invites: FarmInvite[];
  carePlans?: CarePlan[];
}


const ALL_DEPARTMENTS: { value: DepartmentType; label: string }[] = [
  { value: 'poultry', label: 'Poultry' },
  { value: 'fishery', label: 'Fishery' },
  { value: 'crops', label: 'Crops' },
  { value: 'livestock', label: 'Livestock' },
  { value: 'general', label: 'General / Admin' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  farm,
  member,
  pens,
  feedItems,
  salesUnits,
  members,
  invites,
  carePlans = [],
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canEditSettings = hasPermission(member, 'settings', 'edit');
  const canReadSettings = hasPermission(member, 'settings', 'read');
  const canManageMembers = hasPermission(member, 'members', 'manage');
  const canReadMembers = hasPermission(member, 'members', 'read');

  const [tab, setTab] = useState<'profile' | 'pens' | 'careplans' | 'feeds' | 'units' | 'team'>(
    canReadSettings ? 'pens' : 'team'
  );
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Farm profile state
  const [farmName, setFarmName] = useState(farm.name);
  const [farmLocation, setFarmLocation] = useState(farm.location);
  const [farmPhone, setFarmPhone] = useState(farm.contactPhone);
  const [farmEmail, setFarmEmail] = useState(farm.contactEmail);
  const [farmTimezone, setFarmTimezone] = useState(farm.timezone);
  const [savingProfile, setSavingProfile] = useState(false);

  // Pen state
  const [penModal, setPenModal] = useState(false);
  const [editingPen, setEditingPen] = useState<Pen | null>(null);
  const [penName, setPenName] = useState('');
  const [penCode, setPenCode] = useState('');
  const [penCapacity, setPenCapacity] = useState('1000');
  const [penNotes, setPenNotes] = useState('');
  const [penStatus, setPenStatus] = useState<'active' | 'inactive'>('active');

  // Feed item state
  const [feedModal, setFeedModal] = useState(false);
  const [editingFeed, setEditingFeed] = useState<FeedItem | null>(null);
  const [feedType, setFeedType] = useState('');
  const [feedBrand, setFeedBrand] = useState('');
  const [bagWeight, setBagWeight] = useState(String(DEFAULT_BAG_WEIGHT_KG));
  const [feedNotes, setFeedNotes] = useState('');
  const [feedStatus, setFeedStatus] = useState<'active' | 'inactive'>('active');

  // Sales unit state
  const [unitModal, setUnitModal] = useState(false);
  const [editingUnit, setEditingUnit] = useState<SalesUnit | null>(null);
  const [unitName, setUnitName] = useState('');
  const [eggsPerUnit, setEggsPerUnit] = useState('30');
  const [unitPrice, setUnitPrice] = useState('0');
  const [unitEffDate, setUnitEffDate] = useState(todayStr);
  const [unitStatus, setUnitStatus] = useState<'active' | 'inactive'>('active');

  // Team / Invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteTitle, setInviteTitle] = useState('Farm Attendant');
  const [customInviteTitle, setCustomInviteTitle] = useState('');
  const [invitePerms, setInvitePerms] = useState<PermissionsMatrix>(
    structuredClone(DEFAULT_STAFF_PERMISSIONS)
  );
  const [editingMember, setEditingMember] = useState<FarmMember | null>(null);
  const [editMemberTitle, setEditMemberTitle] = useState('');
  const [editMemberStatus, setEditMemberStatus] = useState<'active' | 'inactive'>('active');
  const [editMemberPerms, setEditMemberPerms] = useState<PermissionsMatrix>(
    structuredClone(DEFAULT_STAFF_PERMISSIONS)
  );
  const [saving, setSaving] = useState(false);
  // Pen extra state
  const [penDepartment, setPenDepartment] = useState<DepartmentType>('poultry');
  const [penStaffUids, setPenStaffUids] = useState<string[]>([]);

  // Care Plan state
  const [planModal, setPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CarePlan | null>(null);
  const [planName, setPlanName] = useState('');
  const [planDesc, setPlanDesc] = useState('');
  const [planType, setPlanType] = useState<'medication' | 'vaccination' | 'activity'>('medication');
  const [planStatus, setPlanStatus] = useState<'active' | 'inactive'>('active');

  const [activePlanIdForItems, setActivePlanIdForItems] = useState<string | null>(null);
  const [activePlanItems, setActivePlanItems] = useState<CarePlanItem[]>([]);

  // Care Plan Item state
  const [itemModal, setItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CarePlanItem | null>(null);
  const [itemTitle, setItemTitle] = useState('');
  const [itemReminderType, setItemReminderType] = useState<ReminderType>('medication');
  const [itemDosage, setItemDosage] = useState('');
  const [itemNotes, setItemNotes] = useState('');
  const [itemOffsetDays, setItemOffsetDays] = useState('0');
  const [itemIntervalUnit, setItemIntervalUnit] = useState<RecurrenceUnit>('once');
  const [itemIntervalValue, setItemIntervalValue] = useState('1');
  const [itemSortOrder, setItemSortOrder] = useState('0');

  // Staff extra state
  const [inviteDepartments, setInviteDepartments] = useState<DepartmentType[]>(['poultry']);
  const [invitePenIds, setInvitePenIds] = useState<string[]>([]);
  const [editMemberDepartments, setEditMemberDepartments] = useState<DepartmentType[]>(['poultry']);
  const [editMemberPenIds, setEditMemberPenIds] = useState<string[]>([]);

  const inviteIsOwner = isFarmOwnerTitle(inviteTitle);

  // Real-time subscription to active care plan's schedule tasks
  React.useEffect(() => {
    if (!activePlanIdForItems) {
      setActivePlanItems([]);
      return;
    }
    const unsub = subscribeCarePlanItems(
      farm.farmId,
      activePlanIdForItems,
      (items) => setActivePlanItems(items),
      (err) => setFeedback({ type: 'error', text: formatUserFriendlyError(err) })
    );
    return () => unsub();
  }, [farm.farmId, activePlanIdForItems]);


  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingProfile(true);
    try {
      await updateFarmProfile({
        farmId: farm.farmId,
        name: farmName,
        location: farmLocation,
        contactPhone: farmPhone,
        contactEmail: farmEmail,
        currency: 'NGN',
        timezone: farmTimezone,
        actorUid: member.uid,
        actorName: member.displayName,
        before: {
          name: farm.name,
          location: farm.location,
          contactPhone: farm.contactPhone,
          contactEmail: farm.contactEmail,
          timezone: farm.timezone,
        },
      });
      setFeedback({ type: 'success', text: 'Farm profile updated.' });
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePen = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (editingPen) {
        await updatePen({
          farmId: farm.farmId,
          pen: editingPen,
          name: penName,
          code: penCode,
          capacity: Number(penCapacity),
          notes: penNotes,
          status: penStatus,
          department: penDepartment,
          assignedMemberUids: penStaffUids,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Pen "${penName}" updated.` });
      } else {
        await createPen({
          farmId: farm.farmId,
          name: penName,
          code: penCode,
          capacity: Number(penCapacity),
          notes: penNotes,
          department: penDepartment,
          assignedMemberUids: penStaffUids,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Pen "${penName}" added.` });
      }
      setPenModal(false);
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFeedItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (editingFeed) {
        await updateFeedItem({
          farmId: farm.farmId,
          item: editingFeed,
          feedType,
          brand: feedBrand,
          defaultBagWeightKg: Number(bagWeight),
          notes: feedNotes,
          status: feedStatus,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Feed item "${feedType}" updated.` });
      } else {
        await createFeedItem({
          farmId: farm.farmId,
          feedType,
          brand: feedBrand,
          defaultBagWeightKg: Number(bagWeight),
          notes: feedNotes,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Feed item "${feedType}" added.` });
      }
      setFeedModal(false);
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSalesUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (editingUnit) {
        await updateSalesUnit({
          farmId: farm.farmId,
          unit: editingUnit,
          name: unitName,
          eggCountPerUnit: Number(eggsPerUnit),
          currentPriceNgn: Number(unitPrice),
          effectiveDate: unitEffDate,
          status: unitStatus,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({
          type: 'success',
          text: `Sales unit "${unitName}" updated (past sales snapshots preserved).`,
        });
      } else {
        await createSalesUnit({
          farmId: farm.farmId,
          name: unitName,
          eggCountPerUnit: Number(eggsPerUnit),
          currentPriceNgn: Number(unitPrice),
          effectiveDate: unitEffDate,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Sales unit "${unitName}" created.` });
      }
      setUnitModal(false);
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleInviteStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const resolvedTitle = inviteTitle === 'Custom Role – Create your own' ? customInviteTitle.trim() : inviteTitle;
      if (!resolvedTitle) throw new Error('Enter a custom descriptive job title.');
      await createStaffInvite({
        farmId: farm.farmId,
        farmName: farm.name,
        email: inviteEmail,
        jobTitle: resolvedTitle,
        permissions: invitePerms,
        departments: inviteDepartments,
        assignedPenIds: invitePenIds,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setFeedback({
        type: 'success',
        text: `Invitation created for ${inviteEmail}. When they sign in with Google using this email, they can accept access to ${farm.name}.`,
      });
      setInviteEmail('');
      setCustomInviteTitle('');
      setInviteTitle('Farm Attendant');
      setInviteDepartments(['poultry']);
      setInvitePenIds([]);
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMemberEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    setSaving(true);
    setFeedback(null);
    try {
      await updateStaffMember({
        farmId: farm.farmId,
        target: editingMember,
        jobTitle: editMemberTitle,
        status: editMemberStatus,
        permissions: editMemberPerms,
        departments: editMemberDepartments,
        assignedPenIds: editMemberPenIds,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setFeedback({ type: 'success', text: `Updated access for ${editingMember.displayName}.` });
      setEditingMember(null);
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };


  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (editingPlan) {
        await updateCarePlan({
          farmId: farm.farmId,
          plan: editingPlan,
          name: planName,
          description: planDesc,
          planType,
          status: planStatus,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Care plan "${planName}" updated.` });
      } else {
        const newId = await createCarePlan({
          farmId: farm.farmId,
          name: planName,
          description: planDesc,
          planType,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Care plan "${planName}" created.` });
        setActivePlanIdForItems(newId);
      }
      setPlanModal(false);
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = async (p: CarePlan) => {
    if (!window.confirm(`Delete care plan "${p.name}"? This removes the template schedule.`)) return;
    setSaving(true);
    try {
      await deleteCarePlan({
        farmId: farm.farmId,
        plan: p,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      if (activePlanIdForItems === p.id) setActivePlanIdForItems(null);
      setFeedback({ type: 'success', text: `Care plan "${p.name}" deleted.` });
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePlanIdForItems) return;
    setSaving(true);
    setFeedback(null);
    try {
      const offsetDays = Math.max(0, parseInt(itemOffsetDays, 10) || 0);
      const intervalValue = itemIntervalUnit === 'once' ? 1 : Math.max(1, parseInt(itemIntervalValue, 10) || 1);
      const sortOrder = parseInt(itemSortOrder, 10) || 0;

      if (editingItem) {
        await updateCarePlanItem({
          farmId: farm.farmId,
          item: editingItem,
          title: itemTitle,
          reminderType: itemReminderType,
          dosageOrAction: itemDosage,
          notes: itemNotes,
          offsetDays,
          intervalUnit: itemIntervalUnit,
          intervalValue,
          sortOrder,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Task "${itemTitle}" updated.` });
      } else {
        await createCarePlanItem({
          farmId: farm.farmId,
          carePlanId: activePlanIdForItems,
          title: itemTitle,
          reminderType: itemReminderType,
          dosageOrAction: itemDosage,
          notes: itemNotes,
          offsetDays,
          intervalUnit: itemIntervalUnit,
          intervalValue,
          sortOrder,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Task "${itemTitle}" added to plan.` });
      }
      setItemModal(false);
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (item: CarePlanItem) => {
    if (!window.confirm(`Delete task "${item.title}" from schedule?`)) return;
    setSaving(true);
    try {
      await deleteCarePlanItem({
        farmId: farm.farmId,
        item,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setFeedback({ type: 'success', text: `Task "${item.title}" removed.` });
    } catch (err) {
      setFeedback({ type: 'error', text: formatUserFriendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const renderPermissionMatrixEditor = (
    perms: PermissionsMatrix,
    onChange: (next: PermissionsMatrix) => void
  ) => {
    const toggle = (domain: keyof PermissionsMatrix, key: string) => {
      const next = structuredClone(perms);
      const section = next[domain] as unknown as Record<string, boolean>;
      section[key] = !section[key];
      onChange(next);
    };

    const rows: { domain: keyof PermissionsMatrix; label: string; keys: string[] }[] = [
      { domain: 'batches', label: 'Flocks & Batches', keys: ['read', 'create', 'edit', 'delete'] },
      { domain: 'production', label: 'Egg Production', keys: ['read', 'create', 'edit', 'delete', 'approve'] },
      { domain: 'feed', label: 'Feed & Stock', keys: ['read', 'create', 'edit', 'delete'] },
      {
        domain: 'sales',
        label: 'Egg Sales',
        keys: ['read', 'create', 'edit', 'delete', 'overridePrice'],
      },
      { domain: 'reports', label: 'Reports', keys: ['read', 'export'] },
      { domain: 'settings', label: 'Farm Setup', keys: ['read', 'edit'] },
      { domain: 'members', label: 'Team Management', keys: ['read', 'manage'] },
      { domain: 'eggStore', label: 'Egg Store', keys: ['read', 'transfer', 'receive', 'sort', 'adjust', 'distribute', 'dispose'] },
    ];

    return (
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        {rows.map((r) => {
          const section = perms[r.domain] as unknown as Record<string, boolean>;
          return (
            <div
              key={r.domain}
              className="flex flex-col gap-2 border-b border-slate-200/70 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-xs font-medium text-slate-800">{r.label}</span>
              <div className="flex flex-wrap gap-3">
                {r.keys.map((k) => (
                  <label key={k} className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(section[k])}
                      onChange={() => toggle(r.domain, k)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-800"
                    />
                    <span className="capitalize">{k === 'overridePrice' ? 'Override Price' : k === 'approve' ? 'Approve Production' : k}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Farm Setup &amp; Permissions
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Settings changes apply to future records only; historical price and cost snapshots remain untouched.
        </p>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
        {[
          { id: 'pens', label: 'Pens / Houses', visible: canReadSettings },
          { id: 'careplans', label: 'Care Plans & Schedules', visible: canReadSettings },
          { id: 'feeds', label: 'Feed Catalogue', visible: canReadSettings },
          { id: 'units', label: 'Sales Units & Prices', visible: canReadSettings },
          { id: 'profile', label: 'Farm Profile', visible: canReadSettings },
          { id: 'team', label: 'Team & Permissions', visible: canReadMembers },
        ]
          .filter((t) => t.visible)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {/* Pens Tab */}
      {tab === 'pens' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Poultry Pens / Houses</h2>
              <p className="text-xs text-slate-500">
                Configurable houses for flock placement (1 active batch per pen at a time).
              </p>
            </div>
            {canEditSettings && (
              <button
                type="button"
                onClick={() => {
                  setEditingPen(null);
                  setPenName('');
                  setPenCode('');
                  setPenCapacity('1000');
                  setPenNotes('');
                  setPenStatus('active');
                  setPenDepartment('poultry');
                  setPenStaffUids([]);
                  setPenModal(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-900"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Pen</span>
              </button>
            )}
          </div>

          {pens.length === 0 ? (
            <p className="py-6 text-xs text-slate-500">
              No pens created yet. Add your first poultry house (e.g. Pen A / House 1).
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Pen Name</th>
                    <th className="py-2 font-medium">Code</th>
                    <th className="py-2 font-medium">Department</th>
                    <th className="py-2 text-right font-medium">Capacity</th>
                    <th className="py-2 font-medium">Occupancy</th>
                    <th className="py-2 font-medium">Assigned Staff</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {pens.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 font-medium text-slate-900">{p.name}</td>
                      <td className="py-2.5 font-mono text-slate-600">{p.code}</td>
                      <td className="py-2.5">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-700">
                          {p.department || 'poultry'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono">{p.capacity.toLocaleString()}</td>
                      <td className="py-2.5 text-slate-600">
                        {p.activeBatchId ? 'Occupied (Active Batch)' : 'Available'}
                      </td>
                      <td className="py-2.5 text-slate-600 max-w-xs truncate">
                        {p.assignedMemberUids && p.assignedMemberUids.length > 0
                          ? members
                              .filter((m) => p.assignedMemberUids?.includes(m.uid))
                              .map((m) => m.displayName)
                              .join(', ') || 'Assigned (' + p.assignedMemberUids.length + ')'
                          : 'All / Unassigned'}
                      </td>
                      <td className="py-2.5 capitalize text-slate-700">{p.status}</td>
                      <td className="py-2.5 text-right">
                        {canEditSettings && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPen(p);
                              setPenName(p.name);
                              setPenCode(p.code);
                              setPenCapacity(String(p.capacity));
                              setPenNotes(p.notes);
                              setPenStatus(p.status);
                              setPenDepartment(p.department || 'poultry');
                              setPenStaffUids(p.assignedMemberUids || []);
                              setPenModal(true);
                            }}
                            className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Care Plans & Schedules Tab */}
      {tab === 'careplans' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Standard Care Plans &amp; Protocols</h2>
                <p className="text-xs text-slate-500">
                  Standardized schedules (Medication, Vaccination, Activity) with recurring task rules. Assigning to a batch automatically creates all to-dos.
                </p>
              </div>
              {canEditSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingPlan(null);
                    setPlanName('');
                    setPlanDesc('');
                    setPlanType('medication');
                    setPlanStatus('active');
                    setPlanModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-900 self-start sm:self-auto"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>New Care Plan</span>
                </button>
              )}
            </div>

            {carePlans.length === 0 ? (
              <p className="py-6 text-xs text-slate-500">
                No care plans created yet. Click &quot;New Care Plan&quot; to define medication schedules, vaccination courses, or regular farm activities.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {carePlans.map((p) => {
                  const isSelected = activePlanIdForItems === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
                        isSelected
                          ? 'border-emerald-700 bg-emerald-50/20 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {p.planType === 'medication' && <Pill className="h-4 w-4 text-emerald-800" />}
                            {p.planType === 'vaccination' && <Syringe className="h-4 w-4 text-purple-600" />}
                            {p.planType === 'activity' && <Layers className="h-4 w-4 text-blue-600" />}
                            <span className="font-semibold text-sm text-slate-900">{p.name}</span>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              p.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {p.status}
                          </span>
                        </div>
                        {p.description && (
                          <p className="mt-1.5 text-xs text-slate-600">{p.description}</p>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="capitalize font-medium text-slate-700">{p.planType} Plan</span>
                          <span>•</span>
                          <span>
                            {p.createdAt && typeof p.createdAt === 'string'
                              ? `Created ${p.createdAt.split('T')[0]}`
                              : ''}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setActivePlanIdForItems(null);
                            } else {
                              setActivePlanIdForItems(p.id);
                            }
                          }}
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            isSelected ? 'text-emerald-800' : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {isSelected ? (
                            <>
                              <ChevronDown className="h-3.5 w-3.5" />
                              <span>Hide Schedule Tasks</span>
                            </>
                          ) : (
                            <>
                              <ChevronRight className="h-3.5 w-3.5" />
                              <span>View &amp; Manage Schedule Tasks</span>
                            </>
                          )}
                        </button>
                        {canEditSettings && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPlan(p);
                                setPlanName(p.name);
                                setPlanDesc(p.description || '');
                                setPlanType(p.planType);
                                setPlanStatus(p.status);
                                setPlanModal(true);
                              }}
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              title="Edit Plan"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePlan(p)}
                              className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700"
                              title="Delete Plan"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Plan Tasks Detail */}
          {activePlanIdForItems && (
            <div className="rounded-xl border border-emerald-300 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Tasks for:{' '}
                    <span className="text-emerald-800">
                      {carePlans.find((p) => p.id === activePlanIdForItems)?.name || 'Care Plan'}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Schedule items will be materialized when this plan is assigned to a flock.
                  </p>
                </div>
                {canEditSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingItem(null);
                      setItemTitle('');
                      const currPlan = carePlans.find((p) => p.id === activePlanIdForItems);
                      setItemReminderType(currPlan?.planType === 'vaccination' ? 'vaccination' : 'medication');
                      setItemDosage('');
                      setItemNotes('');
                      setItemOffsetDays('0');
                      setItemIntervalUnit('once');
                      setItemIntervalValue('1');
                      setItemSortOrder(String(activePlanItems.length));
                      setItemModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-900"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Task to Plan</span>
                  </button>
                )}
              </div>

              {activePlanItems.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  No tasks configured for this plan yet. Click &quot;Add Task to Plan&quot; to schedule medications, vaccines, or recurring checks.
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 font-medium">Timing (Day Offset)</th>
                        <th className="py-2 font-medium">Task / Reminder</th>
                        <th className="py-2 font-medium">Type</th>
                        <th className="py-2 font-medium">Frequency</th>
                        <th className="py-2 font-medium">Dosage / Instructions</th>
                        <th className="py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activePlanItems.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2.5 font-mono font-semibold text-emerald-800">
                            Day +{item.offsetDays}
                          </td>
                          <td className="py-2.5">
                            <span className="font-semibold text-slate-900">{item.title}</span>
                            {item.notes && <p className="text-[11px] text-slate-500 mt-0.5">{item.notes}</p>}
                          </td>
                          <td className="py-2.5 capitalize text-slate-700">{item.reminderType}</td>
                          <td className="py-2.5">
                            {item.intervalUnit === 'once' ? (
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">Once</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                <Repeat className="h-3 w-3" />
                                Every {item.intervalValue > 1 ? `${item.intervalValue} ` : ''}
                                {item.intervalUnit}s
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-slate-700">{item.dosageOrAction || '—'}</td>
                          <td className="py-2.5 text-right">
                            {canEditSettings && (
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingItem(item);
                                    setItemTitle(item.title);
                                    setItemReminderType(item.reminderType);
                                    setItemDosage(item.dosageOrAction || '');
                                    setItemNotes(item.notes || '');
                                    setItemOffsetDays(String(item.offsetDays));
                                    setItemIntervalUnit(item.intervalUnit);
                                    setItemIntervalValue(String(item.intervalValue));
                                    setItemSortOrder(String(item.sortOrder));
                                    setItemModal(true);
                                  }}
                                  className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                                  title="Edit Task"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteItem(item)}
                                  className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50"
                                  title="Delete Task"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Feed Catalogue Tab */}
      {tab === 'feeds' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Feed Catalogue &amp; Bag Weights</h2>
              <p className="text-xs text-slate-500">
                Configurable bag weight per feed item (25 kg default).
              </p>
            </div>
            {canEditSettings && (
              <button
                type="button"
                onClick={() => {
                  setEditingFeed(null);
                  setFeedType('');
                  setFeedBrand('');
                  setBagWeight(String(DEFAULT_BAG_WEIGHT_KG));
                  setFeedNotes('');
                  setFeedStatus('active');
                  setFeedModal(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-900"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Feed Item</span>
              </button>
            )}
          </div>

          {feedItems.length === 0 ? (
            <p className="py-6 text-xs text-slate-500">
              No feed items configured yet (e.g. Layer Mash — Topfeeds, 25 kg bag).
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Feed Type</th>
                    <th className="py-2 font-medium">Brand</th>
                    <th className="py-2 text-right font-medium">Default Bag Weight</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {feedItems.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2.5 font-medium text-slate-900">{i.feedType}</td>
                      <td className="py-2.5 text-slate-600">{i.brand}</td>
                      <td className="py-2.5 text-right font-mono">{i.defaultBagWeightKg} kg</td>
                      <td className="py-2.5 capitalize text-slate-700">{i.status}</td>
                      <td className="py-2.5 text-right">
                        {canEditSettings && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingFeed(i);
                              setFeedType(i.feedType);
                              setFeedBrand(i.brand);
                              setBagWeight(String(i.defaultBagWeightKg));
                              setFeedNotes(i.notes);
                              setFeedStatus(i.status);
                              setFeedModal(true);
                            }}
                            className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sales Units Tab */}
      {tab === 'units' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Egg Sales Units &amp; Configured Prices</h2>
              <p className="text-xs text-slate-500">
                Configure units such as Crate (30 eggs), Half Crate (15), or Single Egg (1).
              </p>
            </div>
            {canEditSettings && (
              <button
                type="button"
                onClick={() => {
                  setEditingUnit(null);
                  setUnitName('');
                  setEggsPerUnit('30');
                  setUnitPrice('');
                  setUnitEffDate(todayStr);
                  setUnitStatus('active');
                  setUnitModal(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-900"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Sales Unit</span>
              </button>
            )}
          </div>

          {salesUnits.length === 0 ? (
            <p className="py-6 text-xs text-slate-500">
              No sales units configured yet. Add your farm&apos;s selling units and current NGN prices.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Unit Name</th>
                    <th className="py-2 text-right font-medium">Eggs / Unit</th>
                    <th className="py-2 text-right font-medium">Current Price</th>
                    <th className="py-2 font-medium">Effective Date</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {salesUnits.map((u) => (
                    <tr key={u.id}>
                      <td className="py-2.5 font-medium text-slate-900">{u.name}</td>
                      <td className="py-2.5 text-right font-mono">{u.eggCountPerUnit}</td>
                      <td className="py-2.5 text-right font-mono font-semibold text-emerald-800">
                        {formatNgn(u.currentPriceNgn)}
                      </td>
                      <td className="py-2.5 font-mono text-slate-600">{u.effectiveDate}</td>
                      <td className="py-2.5 capitalize text-slate-700">{u.status}</td>
                      <td className="py-2.5 text-right">
                        {canEditSettings && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUnit(u);
                              setUnitName(u.name);
                              setEggsPerUnit(String(u.eggCountPerUnit));
                              setUnitPrice(String(u.currentPriceNgn));
                              setUnitEffDate(u.effectiveDate);
                              setUnitStatus(u.status);
                              setUnitModal(true);
                            }}
                            className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Farm Profile Tab */}
      {tab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Farm Profile &amp; Regional Settings</h2>
          <div>
            <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700">
              Farm Name
            </label>
            <input
              id="prof-name"
              type="text"
              required
              disabled={!canEditSettings}
              value={farmName}
              onChange={(e) => setFarmName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            />
          </div>
          <div>
            <label htmlFor="prof-loc" className="block text-xs font-medium text-slate-700">
              Location / Address
            </label>
            <input
              id="prof-loc"
              type="text"
              disabled={!canEditSettings}
              value={farmLocation}
              onChange={(e) => setFarmLocation(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="prof-phone" className="block text-xs font-medium text-slate-700">
                Contact Phone
              </label>
              <input
                id="prof-phone"
                type="tel"
                disabled={!canEditSettings}
                value={farmPhone}
                onChange={(e) => setFarmPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
              />
            </div>
            <div>
              <label htmlFor="prof-email" className="block text-xs font-medium text-slate-700">
                Contact Email
              </label>
              <input
                id="prof-email"
                type="email"
                disabled={!canEditSettings}
                value={farmEmail}
                onChange={(e) => setFarmEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
              />
            </div>
          </div>
          <div>
            <label htmlFor="prof-tz" className="block text-xs font-medium text-slate-700">
              Timezone
            </label>
            <select
              id="prof-tz"
              disabled={!canEditSettings}
              value={farmTimezone}
              onChange={(e) => setFarmTimezone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="Africa/Lagos">Africa/Lagos (WAT, UTC+1)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          {canEditSettings && (
            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
            >
              {savingProfile ? 'Saving...' : 'Save Farm Profile'}
            </button>
          )}
        </form>
      )}

      {/* Team & Permissions Tab */}
      {tab === 'team' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Active Farm Members</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Job titles are descriptive only; access is strictly governed by permission checkboxes.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Name / Email</th>
                    <th className="py-2 font-medium">Job Title</th>
                    <th className="py-2 font-medium">Department(s)</th>
                    <th className="py-2 font-medium">Assigned Pen(s)</th>
                    <th className="py-2 font-medium">Role</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((m) => (
                    <tr key={m.uid}>
                      <td className="py-2.5">
                        <div className="font-medium text-slate-900">{m.displayName}</div>
                        <div className="font-mono text-[11px] text-slate-500">{m.email}</div>
                      </td>
                      <td className="py-2.5 text-slate-700">{m.jobTitle}</td>
                      <td className="py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {m.role === 'owner' ? (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                              All Departments
                            </span>
                          ) : m.departments && m.departments.length > 0 ? (
                            m.departments.map((d) => (
                              <span
                                key={d}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-700"
                              >
                                {d}
                              </span>
                            ))
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-700">
                              poultry
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-slate-600 max-w-xs truncate">
                        {m.role === 'owner'
                          ? 'All Pens'
                          : m.assignedPenIds && m.assignedPenIds.length > 0
                          ? pens
                              .filter((p) => m.assignedPenIds?.includes(p.id))
                              .map((p) => p.name)
                              .join(', ') || m.assignedPenIds.length + ' Pens'
                          : 'None'}
                      </td>
                      <td className="py-2.5 capitalize text-slate-700">{m.role}</td>
                      <td className="py-2.5">
                        <span
                          className={`font-medium capitalize ${
                            m.status === 'active' ? 'text-emerald-800' : 'text-red-700'
                          }`}
                        >
                          {m.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {canManageMembers && m.role === 'staff' && m.uid !== member.uid && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMember(m);
                              setEditMemberTitle(m.jobTitle);
                              setEditMemberStatus(m.status);
                              setEditMemberPerms(normalizePermissions(m.permissions));
                              setEditMemberDepartments(m.departments && m.departments.length > 0 ? m.departments : ['poultry']);
                              setEditMemberPenIds(m.assignedPenIds || []);
                            }}
                            className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Edit Access
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {canManageMembers && (
            <form onSubmit={handleInviteStaff} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-emerald-800" />
                <h2 className="text-sm font-semibold text-slate-900">Invite Staff Member</h2>
              </div>
              <p className="text-xs text-slate-500">
                Bound to the verified Google email entered below. One-farm-per-account rules apply.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="inv-email" className="block text-xs font-medium text-slate-700">
                    Staff Google Email <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="inv-email"
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="staff@example.com"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="inv-title" className="block text-xs font-medium text-slate-700">
                    Descriptive Job Title <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="inv-title"
                    required
                    value={inviteTitle}
                    onChange={(e) => setInviteTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {FARM_JOB_TITLES.map((title) => <option key={title} value={title}>{title}</option>)}
                  </select>
                  {inviteTitle === 'Custom Role – Create your own' && (
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={customInviteTitle}
                      onChange={(e) => setCustomInviteTitle(e.target.value)}
                      placeholder="Enter a custom job title"
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>
              </div>

              <div className={inviteIsOwner ? 'hidden' : ''}>
                <label className="block text-xs font-medium text-slate-700">Assigned Department(s) *</label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Staff can only access modules for the departments they are assigned to (e.g. Poultry, Fishery, Crops).
                </p>
                <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  {ALL_DEPARTMENTS.map((dept) => (
                    <label key={dept.value} className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inviteDepartments.includes(dept.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setInviteDepartments([...inviteDepartments, dept.value]);
                          } else {
                            if (inviteDepartments.length > 1) {
                              setInviteDepartments(inviteDepartments.filter((d) => d !== dept.value));
                            }
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-800"
                      />
                      <span>{dept.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={inviteIsOwner ? 'hidden' : ''}>
                <label className="block text-xs font-medium text-slate-700">Assigned Pens / Houses</label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Staff will only see notifications and reminders for their assigned pens.
                </p>
                {pens.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No pens created yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    {pens.map((pen) => (
                      <label key={pen.id} className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={invitePenIds.includes(pen.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setInvitePenIds([...invitePenIds, pen.id]);
                            } else {
                              setInvitePenIds(invitePenIds.filter((id) => id !== pen.id));
                            }
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-800"
                        />
                        <span>{pen.name} ({pen.code})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className={inviteIsOwner ? 'hidden' : ''}>
                <p className="mb-1.5 text-xs font-medium text-slate-700">Assigned Permissions</p>
                {renderPermissionMatrixEditor(invitePerms, setInvitePerms)}
              </div>

              {inviteIsOwner && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Farm Owner access is automatic: all departments, all pens, and every farm-level permission will be granted.
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                <span>{saving ? 'Sending Invite...' : inviteIsOwner ? 'Create Farm Owner Invitation' : 'Create Staff Invitation'}</span>
              </button>
            </form>
          )}

          {invites.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Staff Invitations</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 font-medium">Email</th>
                      <th className="py-2 font-medium">Job Title</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invites.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-2 font-mono">{inv.emailLower}</td>
                        <td className="py-2">{inv.jobTitle}</td>
                        <td className="py-2 capitalize">{inv.status}</td>
                        <td className="py-2 text-right">
                          {canManageMembers && inv.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() =>
                                revokeStaffInvite({
                                  farmId: farm.farmId,
                                  invite: inv,
                                  actorUid: member.uid,
                                  actorName: member.displayName,
                                })
                              }
                              className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pen Modal */}
      {penModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">{editingPen ? 'Edit Pen' : 'Add Pen'}</h3>
              <button type="button" onClick={() => setPenModal(false)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSavePen} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Pen Name *</label>
                <input
                  type="text"
                  required
                  value={penName}
                  onChange={(e) => setPenName(e.target.value)}
                  placeholder="e.g. Layer House A"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Code *</label>
                  <input
                    type="text"
                    required
                    value={penCode}
                    onChange={(e) => setPenCode(e.target.value)}
                    placeholder="PEN-A"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Capacity (Birds)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={penCapacity}
                    onChange={(e) => setPenCapacity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              {editingPen && (
                <div>
                  <label className="block text-xs font-medium text-slate-700">Status</label>
                  <select
                    value={penStatus}
                    onChange={(e) => setPenStatus(e.target.value as 'active' | 'inactive')}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700">Department</label>
                <select
                  value={penDepartment}
                  onChange={(e) => setPenDepartment(e.target.value as DepartmentType)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {ALL_DEPARTMENTS.map((dept) => (
                    <option key={dept.value} value={dept.value}>
                      {dept.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Assigned Staff Members</label>
                <p className="text-[11px] text-slate-500 mb-1">
                  Staff assigned here will see notifications and reminders for this pen.
                </p>
                <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  {members.filter((m) => m.status === 'active').map((m) => (
                    <label key={m.uid} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={penStaffUids.includes(m.uid)}
                        onChange={(e) => {
                          if (e.target.checked) setPenStaffUids([...penStaffUids, m.uid]);
                          else setPenStaffUids(penStaffUids.filter((uid) => uid !== m.uid));
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-800"
                      />
                      <span>{m.displayName} ({m.jobTitle})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Notes</label>
                <input
                  type="text"
                  value={penNotes}
                  onChange={(e) => setPenNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setPenModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white">
                  {saving ? 'Saving...' : 'Save Pen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Feed Item Modal */}
      {feedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingFeed ? 'Edit Feed Item' : 'Add Feed Item'}
              </h3>
              <button type="button" onClick={() => setFeedModal(false)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveFeedItem} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Feed Type *</label>
                <input
                  type="text"
                  required
                  value={feedType}
                  onChange={(e) => setFeedType(e.target.value)}
                  placeholder="e.g. Layer Mash"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Brand *</label>
                  <input
                    type="text"
                    required
                    value={feedBrand}
                    onChange={(e) => setFeedBrand(e.target.value)}
                    placeholder="e.g. Topfeeds"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Bag Weight (kg) *</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    required
                    value={bagWeight}
                    onChange={(e) => setBagWeight(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              {editingFeed && (
                <div>
                  <label className="block text-xs font-medium text-slate-700">Status</label>
                  <select
                    value={feedStatus}
                    onChange={(e) => setFeedStatus(e.target.value as 'active' | 'inactive')}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700">Notes</label>
                <input
                  type="text"
                  value={feedNotes}
                  onChange={(e) => setFeedNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setFeedModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white">
                  {saving ? 'Saving...' : 'Save Feed Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sales Unit Modal */}
      {unitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingUnit ? 'Edit Sales Unit' : 'Add Sales Unit'}
              </h3>
              <button type="button" onClick={() => setUnitModal(false)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSalesUnit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Unit Name *</label>
                <input
                  type="text"
                  required
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder="e.g. Crate (30 eggs)"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Eggs per Unit *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={eggsPerUnit}
                    onChange={(e) => setEggsPerUnit(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Price (NGN) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Effective Date *</label>
                <input
                  type="date"
                  required
                  value={unitEffDate}
                  onChange={(e) => setUnitEffDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              {editingUnit && (
                <div>
                  <label className="block text-xs font-medium text-slate-700">Status</label>
                  <select
                    value={unitStatus}
                    onChange={(e) => setUnitStatus(e.target.value as 'active' | 'inactive')}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setUnitModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white">
                  {saving ? 'Saving...' : 'Save Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Care Plan Modal */}
      {planModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingPlan ? 'Edit Care Plan' : 'Create Care Plan'}
              </h3>
              <button type="button" onClick={() => setPlanModal(false)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSavePlan} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Plan Name *</label>
                <input
                  type="text"
                  required
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="e.g. Broiler 6-Week Standard Medication"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Plan Category *</label>
                  <select
                    value={planType}
                    onChange={(e) => setPlanType(e.target.value as 'medication' | 'vaccination' | 'activity')}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="medication">Medication Plan</option>
                    <option value="vaccination">Vaccination Plan</option>
                    <option value="activity">Activity Plan</option>
                  </select>
                </div>
                {editingPlan && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Status</label>
                    <select
                      value={planStatus}
                      onChange={(e) => setPlanStatus(e.target.value as 'active' | 'inactive')}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Description</label>
                <textarea
                  rows={2}
                  value={planDesc}
                  onChange={(e) => setPlanDesc(e.target.value)}
                  placeholder="Optional details or objectives for this protocol..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setPlanModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white">
                  {saving ? 'Saving...' : 'Save Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Care Plan Task Modal */}
      {itemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingItem ? 'Edit Task in Plan' : 'Add Task to Plan'}
              </h3>
              <button type="button" onClick={() => setItemModal(false)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveItem} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Task / Protocol Title *</label>
                <input
                  type="text"
                  required
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  placeholder="e.g. Gumboro (IBD) 1st Dose"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Task Type *</label>
                  <select
                    value={itemReminderType}
                    onChange={(e) => setItemReminderType(e.target.value as ReminderType)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="medication">Medication</option>
                    <option value="vaccination">Vaccination</option>
                    <option value="feeding">Feeding</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="inspection">Inspection</option>
                    <option value="general">General Activity</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Day Offset (Days from Batch Placement) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={itemOffsetDays}
                    onChange={(e) => setItemOffsetDays(e.target.value)}
                    placeholder="e.g. 7 for Day 8"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                  <span className="text-[10px] text-slate-400">0 = placement day, 7 = 1 week later</span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="block text-xs font-semibold text-slate-800">Recurrence Rule</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600">Interval Unit</label>
                    <select
                      value={itemIntervalUnit}
                      onChange={(e) => setItemIntervalUnit(e.target.value as RecurrenceUnit)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    >
                      <option value="once">Once (No Recurrence)</option>
                      <option value="hour">Hourly (nth hour)</option>
                      <option value="day">Daily (nth day)</option>
                      <option value="week">Weekly (nth week)</option>
                      <option value="month">Monthly (nth month)</option>
                    </select>
                  </div>
                  {itemIntervalUnit !== 'once' && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600">
                        Repeat Every (Interval)
                      </label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={itemIntervalValue}
                        onChange={(e) => setItemIntervalValue(e.target.value)}
                        placeholder="1"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                      />
                      <span className="text-[10px] text-slate-500">
                        e.g. 2 = every 2 {itemIntervalUnit}s
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Dosage / Key Action</label>
                <input
                  type="text"
                  value={itemDosage}
                  onChange={(e) => setItemDosage(e.target.value)}
                  placeholder="e.g. 1 vial in 5L clean drinking water with skimmed milk"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Detailed Instructions / Notes</label>
                <textarea
                  rows={2}
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="Withdraw water 2 hours before administration..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setItemModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white">
                  {saving ? 'Saving...' : 'Save Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Staff Member Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Edit Staff Access: {editingMember.displayName}
              </h3>
              <button type="button" onClick={() => setEditingMember(null)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveMemberEdit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Job Title</label>
                  <input
                    type="text"
                    required
                    value={editMemberTitle}
                    onChange={(e) => setEditMemberTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Status</label>
                  <select
                    value={editMemberStatus}
                    onChange={(e) => setEditMemberStatus(e.target.value as 'active' | 'inactive')}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive (Revokes Access)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Assigned Department(s) *</label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Controls module visibility (Poultry, Fishery, Crops, etc.).
                </p>
                <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  {ALL_DEPARTMENTS.map((dept) => (
                    <label key={dept.value} className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editMemberDepartments.includes(dept.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditMemberDepartments([...editMemberDepartments, dept.value]);
                          } else {
                            if (editMemberDepartments.length > 1) {
                              setEditMemberDepartments(editMemberDepartments.filter((d) => d !== dept.value));
                            }
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-800"
                      />
                      <span>{dept.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Assigned Pens / Houses</label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Staff will only receive reminders and notifications for these pens.
                </p>
                {pens.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No pens created yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    {pens.map((pen) => (
                      <label key={pen.id} className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editMemberPenIds.includes(pen.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditMemberPenIds([...editMemberPenIds, pen.id]);
                            } else {
                              setEditMemberPenIds(editMemberPenIds.filter((id) => id !== pen.id));
                            }
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-800"
                        />
                        <span>{pen.name} ({pen.code})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-700">Granular Permissions</p>
                {renderPermissionMatrixEditor(editMemberPerms, setEditMemberPerms)}
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setEditingMember(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-medium text-white">
                  {saving ? 'Saving...' : 'Save Access'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
