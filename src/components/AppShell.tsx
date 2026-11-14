import React, { useState } from 'react';
import {
  BarChart3,
  ClipboardList,
  Cloud,
  FileSpreadsheet,
  Layers,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  ShoppingBag,
  ShoppingCart,
  WifiOff,
  X,
} from 'lucide-react';
import { hasPermission } from '../domain/calculations.ts';
import type { FirebaseSyncState } from '../lib/firebaseSync.ts';
import type { Farm, FarmMember } from '../types/farm.ts';

export type NavSection =
  | 'dashboard'
  | 'production'
  | 'purchases'
  | 'sales'
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
  }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, visible: true },
    {
      id: 'production',
      label: 'Daily Records',
      icon: ClipboardList,
      visible:
        hasPermission(member, 'production', 'read') ||
        hasPermission(member, 'production', 'create') ||
        hasPermission(member, 'feed', 'read') ||
        hasPermission(member, 'batches', 'read'),
    },
    {
      id: 'purchases',
      label: 'Purchases & Stock',
      icon: ShoppingCart,
      visible: hasPermission(member, 'feed', 'read') || hasPermission(member, 'feed', 'create'),
    },
    {
      id: 'sales',
      label: 'Egg Sales',
      icon: ShoppingBag,
      visible: hasPermission(member, 'sales', 'read') || hasPermission(member, 'sales', 'create'),
    },
    {
      id: 'batches',
      label: 'Flocks & Batches',
      icon: Layers,
      visible: hasPermission(member, 'batches', 'read'),
    },
    {
      id: 'reports',
      label: 'Reports & Audit',
      icon: FileSpreadsheet,
      visible: hasPermission(member, 'reports', 'read') || member.role === 'owner',
    },
    {
      id: 'settings',
      label: 'Farm Setup',
      icon: Settings,
      visible:
        hasPermission(member, 'settings', 'read') ||
        hasPermission(member, 'members', 'read') ||
        member.role === 'owner',
    },
  ];

  const visibleItems = navItems.filter((item) => item.visible);
  const currentLabel = visibleItems.find((i) => i.id === activeSection)?.label || 'Dashboard';

  const handleNavClick = (id: NavSection) => {
    onSelectSection(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="font-display text-base font-bold tracking-tight text-slate-900 truncate">
            {farm.name}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 truncate">
            Poultry Layer MVP · {farm.currency}
          </p>
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
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-800 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
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
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex h-full w-72 max-w-full flex-col bg-white border-r border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <p className="font-display text-base font-bold text-slate-900 truncate">{farm.name}</p>
                <p className="text-xs text-slate-500">Poultry Layer MVP</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active ? 'bg-emerald-800 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-900 truncate">{member.displayName}</p>
              <p className="text-xs text-slate-500 truncate">{member.jobTitle}</p>
              <button
                type="button"
                onClick={onSignOut}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="truncate">{farm.name}</span>
                <span aria-hidden="true">/</span>
                <span className="font-medium text-slate-800 truncate">{currentLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
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
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                syncState === 'offline'
                  ? 'font-medium text-amber-800'
                  : syncState === 'syncing'
                  ? 'font-medium text-slate-600'
                  : 'text-slate-400'
              }`}
            >
              {syncState === 'offline' && (
                <>
                  <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                  <span>Offline mode</span>
                </>
              )}
              {syncState === 'syncing' && (
                <>
                  <RefreshCw
                    className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-700"
                    aria-hidden="true"
                  />
                  <span>Syncing...</span>
                </>
              )}
              {syncState === 'synced' && (
                <>
                  <Cloud className="h-3.5 w-3.5 shrink-0 text-emerald-700/75" aria-hidden="true" />
                  <span>Synced</span>
                </>
              )}
            </div>
            <span className="hidden sm:inline h-3.5 w-px bg-slate-200" aria-hidden="true" />
            <span className="hidden sm:inline font-mono">{farm.timezone}</span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
};
