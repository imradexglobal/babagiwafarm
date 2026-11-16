import React, { useState } from 'react';
import {
  BarChart3,
  Sprout,
  ClipboardList,
  Cloud,
  FileSpreadsheet,
  Layers,
  LogOut,
  Menu,
  MoreHorizontal,
  RefreshCw,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { hasDepartmentAccess, hasPermission } from '../domain/calculations.ts';
import type { FirebaseSyncState } from '../lib/firebaseSync.ts';
import type { Farm, FarmMember } from '../types/farm.ts';

export type NavSection =
  | 'dashboard'
  | 'production'
  | 'eggStore'
  | 'purchases'
  | 'sales'
  | 'accounts'
  | 'batches'
  | 'reports'
  | 'settings';

interface AppShellProps {
  farm: Farm;
  member: FarmMember;
  activeSection: NavSection;
  syncState?: FirebaseSyncState;
  onSelectSection: (section: NavSection) => void;
  onSignOut: () => Promise<void>;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  farm,
  member,
  activeSection,
  syncState = 'synced',
  onSelectSection,
  onSignOut,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: {
    id: NavSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    visible: boolean;
    group: 'operations' | 'management';
  }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, visible: true, group: 'operations' },
    {
      id: 'production',
      label: 'Daily Records',
      icon: ClipboardList,
      group: 'operations',
      visible:
        hasDepartmentAccess(member, 'poultry') &&
        (hasPermission(member, 'production', 'read') ||
        hasPermission(member, 'production', 'create') ||
        hasPermission(member, 'feed', 'read') ||
        hasPermission(member, 'batches', 'read')),
    },
    {
      id: 'purchases',
      label: 'Purchases & Stock',
      icon: ShoppingCart,
      group: 'operations',
      visible: hasPermission(member, 'feed', 'read') || hasPermission(member, 'feed', 'create'),
    },
    {
      id: 'sales',
      label: 'Egg Sales',
      icon: ShoppingBag,
      group: 'operations',
      visible: hasPermission(member, 'sales', 'read') || hasPermission(member, 'sales', 'create'),
    },
    {
      id: 'eggStore',
      label: 'Egg Store',
      icon: ShoppingBag,
      group: 'management',
      visible:
        hasDepartmentAccess(member, 'poultry') &&
        (hasPermission(member, 'eggStore', 'read') ||
        hasPermission(member, 'eggStore', 'transfer') ||
        hasPermission(member, 'eggStore', 'receive') ||
        hasPermission(member, 'eggStore', 'sort') ||
        hasPermission(member, 'eggStore', 'adjust') ||
        hasPermission(member, 'eggStore', 'distribute') ||
        hasPermission(member, 'eggStore', 'dispose')),
    },
    {
      id: 'accounts',
      label: 'Customers & Vendors',
      icon: Users,
      group: 'management',
      visible:
        member.role === 'owner' ||
        hasPermission(member, 'reports', 'read') ||
        hasPermission(member, 'sales', 'read') ||
        hasPermission(member, 'sales', 'create') ||
        hasPermission(member, 'feed', 'read') ||
        hasPermission(member, 'feed', 'create'),
    },
    {
      id: 'batches',
      label: 'Flocks & Batches',
      icon: Layers,
      group: 'management',
      visible: hasDepartmentAccess(member, 'poultry') && hasPermission(member, 'batches', 'read'),
    },
    {
      id: 'reports',
      label: 'Reports & Audit',
      icon: FileSpreadsheet,
      group: 'management',
      visible: hasPermission(member, 'reports', 'read') || member.role === 'owner',
    },
    {
      id: 'settings',
      label: 'Farm Setup',
      icon: Settings,
      group: 'management',
      visible:
        hasPermission(member, 'settings', 'read') ||
        hasPermission(member, 'members', 'read') ||
        member.role === 'owner',
    },
  ];

  const visibleItems = navItems.filter((item) => item.visible);
  const currentLabel = visibleItems.find((i) => i.id === activeSection)?.label || 'Dashboard';

  const isSecondaryActive = ['eggStore', 'accounts', 'batches', 'reports', 'settings'].includes(activeSection);

  const handleNavClick = (id: NavSection) => {
    onSelectSection(id);
    setMobileMenuOpen(false);
  };

  // Primary 4 sections for mobile bottom navigation bar
  const bottomNavItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
    { id: 'production' as const, label: 'Records', icon: ClipboardList },
    { id: 'purchases' as const, label: 'Stock', icon: ShoppingCart },
    { id: 'sales' as const, label: 'Sales', icon: ShoppingBag },
    { id: 'more' as const, label: 'More', icon: MoreHorizontal },
  ];

  return (
    <div className="min-h-screen bg-[#fcfbf7] text-stone-900 lg:flex">
      {/* Desktop Sidebar (Preserved 100% with Agricultural Theme) */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-stone-200/80 lg:bg-white shadow-[2px_0_12px_rgba(15,61,46,0.03)]">
        <div className="border-b border-stone-200/80 px-5 py-4 bg-gradient-to-b from-emerald-50/60 to-transparent">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-700 to-green-900 text-white shadow-xs">
              <Sprout className="h-5 w-5 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-base font-bold tracking-tight text-emerald-950 truncate">
                {farm.name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 border border-amber-200/60">
                  🌾 Agro-Allied
                </span>
                <span className="text-[11px] font-mono text-stone-500">{farm.currency}</span>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Primary Farm Navigation">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all cursor-pointer ${
                  active
                    ? 'bg-gradient-to-r from-emerald-800 to-green-900 text-white shadow-sm ring-1 ring-emerald-950/20'
                    : 'text-stone-700 hover:bg-emerald-50/60 hover:text-emerald-950'
                }`}
              >
                <div className="flex items-center gap-3 truncate">
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-emerald-200' : 'text-emerald-800'}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {active && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 truncate">{member.displayName}</p>
            <p className="mt-0.5 text-slate-500 truncate">
              {member.jobTitle} · {member.role === 'owner' ? 'Owner' : 'Staff'}
            </p>
            {member.departments && member.departments.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {member.departments.map((dept) => (
                  <span key={dept} className="rounded bg-emerald-100/70 px-1.5 py-0.5 text-[10px] font-medium capitalize text-emerald-800">
                    {dept}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Android-Style Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex h-full w-[85%] max-w-xs flex-col bg-white border-r border-slate-200 shadow-2xl">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-stone-200/80 bg-gradient-to-b from-emerald-50/80 to-white px-5 py-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-700 to-green-900 text-white shadow-xs">
                  <Sprout className="h-5 w-5 text-emerald-200" />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-base font-bold text-emerald-950 truncate">{farm.name}</p>
                  <p className="text-[11px] text-amber-800 font-semibold">Agro-Allied Poultry · {farm.currency}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Member Profile Card in Drawer */}
            <div className="border-b border-stone-200/80 px-5 py-3.5 bg-emerald-50/40 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-800 to-green-900 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                {member.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-stone-900 truncate">{member.displayName}</p>
                <p className="text-xs text-stone-500 truncate">
                  {member.jobTitle} · <span className="font-semibold text-emerald-800 capitalize">{member.role}</span>
                </p>
              </div>
            </div>

            {/* Scrollable Navigation List */}
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4 touch-scroll" aria-label="Mobile Navigation">
              <div>
                <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Operations</p>
                <div className="mt-1 space-y-0.5">
                  {visibleItems.filter((i) => i.group === 'operations').map((item) => {
                    const Icon = item.icon;
                    const active = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleNavClick(item.id)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                          active
                            ? 'bg-emerald-800 text-white shadow-xs'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Management &amp; Setup</p>
                <div className="mt-1 space-y-0.5">
                  {visibleItems.filter((i) => i.group === 'management').map((item) => {
                    const Icon = item.icon;
                    const active = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleNavClick(item.id)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                          active
                            ? 'bg-emerald-800 text-white shadow-xs'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </nav>

            {/* Drawer Footer */}
            <div className="border-t border-slate-200 p-4 bg-slate-50/50 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <button
                type="button"
                onClick={onSignOut}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-100 active:scale-98 transition-transform cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile & Desktop Header */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-stone-200/80 bg-[#fcfbf7]/95 px-3.5 py-2.5 sm:px-6 sm:py-3 backdrop-blur-md pt-[calc(0.625rem+env(safe-area-inset-top,0px))] shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-xl p-2 text-emerald-950 hover:bg-emerald-50 active:bg-emerald-100 lg:hidden cursor-pointer shrink-0 border border-stone-200/80 bg-white shadow-2xs"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5 text-emerald-900" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 lg:hidden truncate">
                <Sprout className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                <p className="text-[11px] font-bold tracking-wide uppercase text-emerald-950 truncate">
                  {farm.name}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-stone-500">
                <span className="hidden lg:inline font-semibold text-emerald-950 truncate">{farm.name}</span>
                <span className="hidden lg:inline text-stone-300" aria-hidden="true">/</span>
                <span className="font-bold text-stone-900 text-sm lg:text-xs truncate">{currentLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-500 shrink-0">
            <div
              role="status"
              aria-live="polite"
              data-sync-state={syncState}
              title={
                syncState === 'offline'
                  ? 'Operating in offline mode — changes will sync to Firebase when back online'
                  : syncState === 'syncing'
                  ? 'Syncing farm records with Firebase'
                  : 'All farm records synced with Firebase'
              }
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium whitespace-nowrap shrink-0 ${
                syncState === 'offline'
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : syncState === 'syncing'
                  ? 'bg-slate-100 text-slate-700 border border-slate-200'
                  : 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              }`}
            >
              {syncState === 'offline' && (
                <>
                  <WifiOff className="h-3 w-3 shrink-0 text-amber-700" aria-hidden="true" />
                  <span className="hidden xs:inline">Offline</span>
                </>
              )}
              {syncState === 'syncing' && (
                <>
                  <RefreshCw
                    className="h-3 w-3 shrink-0 animate-spin text-emerald-700"
                    aria-hidden="true"
                  />
                  <span>Syncing</span>
                </>
              )}
              {syncState === 'synced' && (
                <>
                  <Cloud className="h-3 w-3 shrink-0 text-emerald-700" aria-hidden="true" />
                  <span className="hidden xs:inline">Synced</span>
                </>
              )}
            </div>
            <span className="hidden sm:inline h-3.5 w-px bg-slate-200" aria-hidden="true" />
            <span className="hidden sm:inline font-mono">{farm.timezone}</span>
          </div>
        </header>

        {/* Content with bottom navigation spacing on mobile */}
        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 pb-24 lg:pb-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      {/* Android Mobile Bottom Navigation Bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-stone-200/80 bg-[#fcfbf7]/95 px-1 backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)] lg:hidden shadow-[0_-2px_12px_rgba(15,61,46,0.06)]"
        aria-label="Mobile Bottom Navigation"
      >
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === 'more' ? isSecondaryActive : activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === 'more') {
                  setMobileMenuOpen(true);
                } else {
                  handleNavClick(item.id as NavSection);
                }
              }}
              className={`relative flex flex-1 flex-col items-center justify-center py-1 text-[10px] font-medium transition-colors cursor-pointer active:scale-95 ${
                isActive ? 'text-emerald-950 font-bold' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <div
                className={`flex items-center justify-center rounded-full px-3.5 py-1 transition-all ${
                  isActive ? 'bg-gradient-to-r from-emerald-800 to-green-900 text-white shadow-xs' : ''
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span className="mt-0.5 tracking-tight">{item.label}</span>
              {item.id === 'more' && isSecondaryActive && (
                <span className="absolute top-1.5 right-6 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
