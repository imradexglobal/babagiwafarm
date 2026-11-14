import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AppShell, type NavSection } from './components/AppShell.tsx';
import { BatchesView } from './components/BatchesView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { FeedView } from './components/FeedView.tsx';
import { LandingPage } from './components/LandingPage.tsx';
import { OnboardingView } from './components/OnboardingView.tsx';
import { ProductionView } from './components/ProductionView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { SalesView } from './components/SalesView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { hasPermission } from './domain/calculations.ts';
import { auth, formatUserFriendlyError } from './lib/firebase.ts';
import {
  acceptPendingInvite,
  createFarmAndOwner,
  getPendingInviteForEmail,
  getUserBinding,
  signInWithGoogle,
  signOutUser,
  subscribeCurrentMember,
  subscribeFarmProfile,
} from './services/authService.ts';
import { subscribeBatches } from './services/batchService.ts';
import {
  subscribeAuditLogs,
  subscribeFeedItems,
  subscribeFeedStock,
  subscribeInvites,
  subscribeMembers,
  subscribePens,
  subscribeSalesUnits,
} from './services/farmSetupService.ts';
import { subscribeFeedConsumption, subscribeFeedPurchases } from './services/feedService.ts';
import { subscribeEggProduction } from './services/productionService.ts';
import { subscribeEggSales } from './services/salesService.ts';
import type {
  AuditLog,
  EggProductionEntry,
  EggSale,
  Farm,
  FarmInvite,
  FarmMember,
  FeedConsumption,
  FeedItem,
  FeedPurchase,
  FeedStock,
  Pen,
  PendingInvite,
  PoultryBatch,
  SalesUnit,
  UserFarmBinding,
} from './types/farm.ts';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [bindingLoading, setBindingLoading] = useState(false);
  const [userBinding, setUserBinding] = useState<UserFarmBinding | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);

  const [farm, setFarm] = useState<Farm | null>(null);
  const [member, setMember] = useState<FarmMember | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');

  // Tenant operational collections
  const [pens, setPens] = useState<Pen[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedStocks, setFeedStocks] = useState<FeedStock[]>([]);
  const [salesUnits, setSalesUnits] = useState<SalesUnit[]>([]);
  const [batches, setBatches] = useState<PoultryBatch[]>([]);
  const [production, setProduction] = useState<EggProductionEntry[]>([]);
  const [purchases, setPurchases] = useState<FeedPurchase[]>([]);
  const [consumptions, setConsumptions] = useState<FeedConsumption[]>([]);
  const [sales, setSales] = useState<EggSale[]>([]);
  const [members, setMembers] = useState<FarmMember[]>([]);
  const [invites, setInvites] = useState<FarmInvite[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const loadBinding = useCallback(async (currentUser: User) => {
    setBindingLoading(true);
    setAuthError(null);
    setDataError(null);
    try {
      const binding = await getUserBinding(currentUser.uid);
      setUserBinding(binding);
      if (!binding && currentUser.email) {
        const invite = await getPendingInviteForEmail(currentUser.email);
        setPendingInvite(invite);
      } else {
        setPendingInvite(null);
      }
    } catch (err) {
      setAuthError(formatUserFriendlyError(err));
    } finally {
      setBindingLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        await loadBinding(nextUser);
      } else {
        setUserBinding(null);
        setPendingInvite(null);
        setFarm(null);
        setMember(null);
        setPens([]);
        setFeedItems([]);
        setFeedStocks([]);
        setSalesUnits([]);
        setBatches([]);
        setProduction([]);
        setPurchases([]);
        setConsumptions([]);
        setSales([]);
        setMembers([]);
        setInvites([]);
        setAuditLogs([]);
      }
    });
    return unsub;
  }, [loadBinding]);

  // Subscribe to farm profile and current member record once userBinding exists
  useEffect(() => {
    if (!authReady || !user || !userBinding) return;
    const farmId = userBinding.farmId;

    const unsubFarm = subscribeFarmProfile(
      farmId,
      (f) => setFarm(f),
      (err) => setDataError(formatUserFriendlyError(err))
    );
    const unsubMember = subscribeCurrentMember(
      farmId,
      user.uid,
      (m) => setMember(m),
      (err) => setDataError(formatUserFriendlyError(err))
    );

    return () => {
      unsubFarm();
      unsubMember();
    };
  }, [authReady, user, userBinding]);

  // Permission-gated subscriptions for operational collections
  useEffect(() => {
    if (!authReady || !user || !userBinding || !member || member.status !== 'active') return;
    const farmId = userBinding.farmId;
    const unsubs: (() => void)[] = [];
    const onErr = (err: Error) => setDataError(formatUserFriendlyError(err));

    // Active members can read reference setup & batches
    unsubs.push(subscribePens(farmId, setPens, onErr));
    unsubs.push(subscribeFeedItems(farmId, setFeedItems, onErr));
    unsubs.push(subscribeFeedStock(farmId, setFeedStocks, onErr));
    unsubs.push(subscribeSalesUnits(farmId, setSalesUnits, onErr));
    unsubs.push(subscribeBatches(farmId, setBatches, onErr));

    const canReadReports = hasPermission(member, 'reports', 'read') || member.role === 'owner';

    if (hasPermission(member, 'production', 'read') || canReadReports) {
      unsubs.push(subscribeEggProduction(farmId, setProduction, onErr));
    }
    if (hasPermission(member, 'feed', 'read') || canReadReports) {
      unsubs.push(subscribeFeedPurchases(farmId, setPurchases, onErr));
      unsubs.push(subscribeFeedConsumption(farmId, setConsumptions, onErr));
    }
    if (hasPermission(member, 'sales', 'read') || canReadReports) {
      unsubs.push(subscribeEggSales(farmId, setSales, onErr));
    }
    if (hasPermission(member, 'members', 'read') || member.role === 'owner') {
      unsubs.push(subscribeMembers(farmId, setMembers, onErr));
      unsubs.push(subscribeInvites(farmId, setInvites, onErr));
    }
    if (canReadReports) {
      unsubs.push(subscribeAuditLogs(farmId, setAuditLogs, onErr));
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [authReady, user, userBinding, member]);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(formatUserFriendlyError(err));
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    setActiveSection('dashboard');
  };

  const handleCreateFarm = async (params: {
    farmName: string;
    location: string;
    contactPhone: string;
    contactEmail: string;
    timezone: string;
  }) => {
    if (!user) return;
    await createFarmAndOwner({ user, ...params });
    await loadBinding(user);
  };

  const handleAcceptInvite = async (invite: PendingInvite) => {
    if (!user) return;
    await acceptPendingInvite({ user, invite });
    await loadBinding(user);
  };

  if (!authReady || (user && bindingLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-center">
          <p className="font-display text-base font-semibold text-slate-900">Babagiwa Farms</p>
          <p className="mt-1 text-xs text-slate-500">Verifying authenticated farm session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage onSignIn={handleSignIn} authError={authError} />;
  }

  if (!userBinding) {
    return (
      <OnboardingView
        user={user}
        pendingInvite={pendingInvite}
        onCreateFarm={handleCreateFarm}
        onAcceptInvite={handleAcceptInvite}
        onSignOut={handleSignOut}
      />
    );
  }

  if (!farm || !member) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="font-display text-base font-semibold text-slate-900">Loading Farm Workspace</p>
          <p className="mt-1 text-xs text-slate-500">
            Fetching farm configuration and membership permissions...
          </p>
          {dataError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {dataError}
            </div>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (member.status !== 'active') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center">
          <h1 className="text-lg font-bold text-slate-900">Farm Membership Inactive</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your access to <strong>{farm.name}</strong> has been deactivated by the farm owner.
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      farm={farm}
      member={member}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      onSignOut={handleSignOut}
    >
      {dataError && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {dataError}
        </div>
      )}

      {activeSection === 'dashboard' && (
        <DashboardView
          farm={farm}
          member={member}
          pens={pens}
          batches={batches}
          feedItems={feedItems}
          feedStocks={feedStocks}
          salesUnits={salesUnits}
          production={production}
          consumptions={consumptions}
          sales={sales}
          onNavigate={setActiveSection}
        />
      )}

      {activeSection === 'production' && (
        <ProductionView
          farm={farm}
          member={member}
          batches={batches}
          production={production}
        />
      )}

      {activeSection === 'feed' && (
        <FeedView
          farm={farm}
          member={member}
          batches={batches}
          feedItems={feedItems}
          feedStocks={feedStocks}
          purchases={purchases}
          consumptions={consumptions}
        />
      )}

      {activeSection === 'sales' && (
        <SalesView
          farm={farm}
          member={member}
          salesUnits={salesUnits}
          sales={sales}
        />
      )}

      {activeSection === 'batches' && (
        <BatchesView
          farm={farm}
          member={member}
          pens={pens}
          batches={batches}
          production={production}
          consumptions={consumptions}
        />
      )}

      {activeSection === 'reports' && (
        <ReportsView
          farm={farm}
          member={member}
          batches={batches}
          feedItems={feedItems}
          feedStocks={feedStocks}
          auditLogs={auditLogs}
        />
      )}

      {activeSection === 'settings' && (
        <SettingsView
          farm={farm}
          member={member}
          pens={pens}
          feedItems={feedItems}
          salesUnits={salesUnits}
          members={members}
          invites={invites}
        />
      )}
    </AppShell>
  );
}
