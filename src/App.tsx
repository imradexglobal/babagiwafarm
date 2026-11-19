import { Suspense, useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AppShell, type NavSection } from './components/AppShell.tsx';
import type { DailyProductionSubTab } from './components/DailyProductionView.tsx';
import { lazyNamed } from './lib/lazyNamed.ts';
import { LandingPage } from './components/LandingPage.tsx';
import { OnboardingView } from './components/OnboardingView.tsx';
const AccountsView = lazyNamed(() => import('./components/AccountsView.tsx'), 'AccountsView');
const BatchesView = lazyNamed(() => import('./components/BatchesView.tsx'), 'BatchesView');
const CropsView = lazyNamed(() => import('./components/CropsView.tsx'), 'CropsView');
const EggStoreView = lazyNamed(() => import('./components/EggStoreView.tsx'), 'EggStoreView');
const FisheryView = lazyNamed(() => import('./components/FisheryView.tsx'), 'FisheryView');
const LivestockView = lazyNamed(() => import('./components/LivestockView.tsx'), 'LivestockView');
const DailyProductionView = lazyNamed(() => import('./components/DailyProductionView.tsx'), 'DailyProductionView');
const DashboardView = lazyNamed(() => import('./components/DashboardView.tsx'), 'DashboardView');
const PurchasesView = lazyNamed(() => import('./components/PurchasesView.tsx'), 'PurchasesView');
const ReportsView = lazyNamed(() => import('./components/ReportsView.tsx'), 'ReportsView');
const SalesView = lazyNamed(() => import('./components/SalesView.tsx'), 'SalesView');
const SettingsView = lazyNamed(() => import('./components/SettingsView.tsx'), 'SettingsView');
import { formatDateInTimezone, hasPermission } from './domain/calculations.ts';
import { useFirebaseSyncStatus } from './hooks/useFirebaseSyncStatus.ts';
import { auth, formatUserFriendlyError } from './lib/firebase.ts';
import { Building2, RefreshCw } from 'lucide-react';
import {
  acceptPendingInvite,
  rejectPendingInvite,
  clearUserBinding,
  createFarmAndOwner,
  getPendingInviteForEmail,
  getUserBinding,
  signInWithGoogle,
  signOutUser,
  subscribeCurrentMember,
  subscribeFarmProfile,
} from './services/authService.ts';
import { subscribeBatches } from './services/batchService.ts';
import { subscribeCarePlans } from './services/carePlanService.ts';
import {
  subscribeEnvironmentLogs,
  subscribeMedicationLogs,
} from './services/dailyRecordsService.ts';
import { subscribeRecordDrafts } from './services/draftsService.ts';
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
import { subscribeMortalityEntries } from './services/mortalityService.ts';
import { subscribeEggProduction } from './services/productionService.ts';
import { subscribeFarmPurchases } from './services/purchasesService.ts';
import { subscribeFarmReminders } from './services/remindersService.ts';
import { subscribeEggSales } from './services/salesService.ts';
import {
  subscribeAccountPayments,
  subscribeCustomers,
  subscribePurchaseInvoices,
  subscribeSalesInvoices,
  subscribeVendors,
} from './services/accountsService.ts';
import {
  subscribeEggInventoryBalances,
  subscribeEggInventoryMovements,
  subscribeEggSortingBatches,
  subscribeEggStoreReceipts,
  subscribeEggStoreSettings,
  subscribeEggTransfers,
} from './services/eggStoreService.ts';
import type {
  AuditLog,
  CarePlan,
  EggProductionEntry,
  EggSale,
  EnvironmentMetricLog,
  Farm,
  FarmInvite,
  FarmMember,
  FarmPurchase,
  FarmReminder,
  FeedConsumption,
  FeedItem,
  FeedPurchase,
  FeedStock,
  MedicationLog,
  MortalityEntry,
  Pen,
  PendingInvite,
  PoultryBatch,
  RecordDraft,
  SalesUnit,
  UserFarmBinding,
} from './types/farm.ts';
import type {
  AccountPayment,
  Customer,
  PurchaseInvoice,
  SalesInvoice,
  Vendor,
} from './types/accounts.ts';
import type {
  EggInventoryBalance,
  EggInventoryMovement,
  EggSortingBatch,
  EggStoreReceipt,
  EggStoreSettings,
  EggTransfer,
} from './types/eggStore.ts';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [bindingLoading, setBindingLoading] = useState(false);
  const [userBinding, setUserBinding] = useState<UserFarmBinding | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);

  const [farm, setFarm] = useState<Farm | null>(null);
  const [member, setMember] = useState<FarmMember | null>(null);
  const [farmLoaded, setFarmLoaded] = useState(false);
  const [memberLoaded, setMemberLoaded] = useState(false);
  const [farmMissing, setFarmMissing] = useState(false);
  const [memberMissing, setMemberMissing] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');

  // Tenant operational collections
  const [pens, setPens] = useState<Pen[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedStocks, setFeedStocks] = useState<FeedStock[]>([]);
  const [salesUnits, setSalesUnits] = useState<SalesUnit[]>([]);
  const [batches, setBatches] = useState<PoultryBatch[]>([]);
  const [carePlans, setCarePlans] = useState<CarePlan[]>([]);
  const [production, setProduction] = useState<EggProductionEntry[]>([]);
  const [purchases, setPurchases] = useState<FeedPurchase[]>([]);
  const [farmPurchases, setFarmPurchases] = useState<FarmPurchase[]>([]);
  const [consumptions, setConsumptions] = useState<FeedConsumption[]>([]);
  const [sales, setSales] = useState<EggSale[]>([]);
  const [mortalityEntries, setMortalityEntries] = useState<MortalityEntry[]>([]);
  const [medicationLogs, setMedicationLogs] = useState<MedicationLog[]>([]);
  const [environmentLogs, setEnvironmentLogs] = useState<EnvironmentMetricLog[]>([]);
  const [drafts, setDrafts] = useState<RecordDraft[]>([]);
  const [farmReminders, setFarmReminders] = useState<FarmReminder[]>([]);
  const [members, setMembers] = useState<FarmMember[]>([]);
  const [invites, setInvites] = useState<FarmInvite[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [salesInvoices, setSalesInvoices] = useState<SalesInvoice[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoice[]>([]);
  const [accountPayments, setAccountPayments] = useState<AccountPayment[]>([]);
  const [eggStoreSettings, setEggStoreSettings] = useState<EggStoreSettings | null>(null);
  const [eggTransfers, setEggTransfers] = useState<EggTransfer[]>([]);
  const [eggStoreReceipts, setEggStoreReceipts] = useState<EggStoreReceipt[]>([]);
  const [eggSortingBatches, setEggSortingBatches] = useState<EggSortingBatch[]>([]);
  const [eggInventoryBalances, setEggInventoryBalances] = useState<EggInventoryBalance[]>([]);
  const [eggInventoryMovements, setEggInventoryMovements] = useState<EggInventoryMovement[]>([]);

  // Linked BatchesView -> DailyProductionView (Mortality tab) navigation context
  const [dailyInitialSubTab, setDailyInitialSubTab] = useState<DailyProductionSubTab>('egg');
  const [mortalityInitialBatchId, setMortalityInitialBatchId] = useState<string | undefined>(
    undefined
  );
  const [mortalityAutoOpenModal, setMortalityAutoOpenModal] = useState(false);

  const { syncState, onFarmMetadata } = useFirebaseSyncStatus(Boolean(authReady && user && userBinding));

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
        setFarmPurchases([]);
        setConsumptions([]);
        setSales([]);
        setMortalityEntries([]);
        setMedicationLogs([]);
        setEnvironmentLogs([]);
        setDrafts([]);
        setFarmReminders([]);
        setMembers([]);
        setInvites([]);
        setAuditLogs([]);
        setCustomers([]);
        setVendors([]);
        setSalesInvoices([]);
        setPurchaseInvoices([]);
        setAccountPayments([]);
        setEggStoreSettings(null);
        setEggTransfers([]);
        setEggStoreReceipts([]);
        setEggSortingBatches([]);
        setEggInventoryBalances([]);
        setEggInventoryMovements([]);
      }
    });
    return unsub;
  }, [loadBinding]);

  // Subscribe to farm profile and current member record once userBinding exists
  useEffect(() => {
    if (!authReady || !user || !userBinding) {
      setFarm(null);
      setMember(null);
      setFarmLoaded(false);
      setMemberLoaded(false);
      setFarmMissing(false);
      setMemberMissing(false);
      return;
    }
    const farmId = userBinding.farmId;

    const unsubFarm = subscribeFarmProfile(
      farmId,
      (f) => {
        setFarmLoaded(true);
        if (f) {
          setFarm(f);
          setFarmMissing(false);
        } else {
          setFarm(null);
          setFarmMissing(true);
        }
      },
      (err) => {
        setFarmLoaded(true);
        setDataError(formatUserFriendlyError(err));
      },
      onFarmMetadata
    );
    const unsubMember = subscribeCurrentMember(
      farmId,
      user.uid,
      (m) => {
        setMemberLoaded(true);
        if (m) {
          setMember(m);
          setMemberMissing(false);
        } else {
          setMember(null);
          setMemberMissing(true);
        }
      },
      (err) => {
        setMemberLoaded(true);
        setDataError(formatUserFriendlyError(err));
      }
    );

    return () => {
      unsubFarm();
      unsubMember();
    };
  }, [authReady, user, userBinding, onFarmMetadata, reloadSeq]);

  // Loading safety timeout: if workspace configuration is taking long, offer retry and reset
  useEffect(() => {
    if (!userBinding || (farm && member) || farmMissing || memberMissing) {
      setLoadTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      setLoadTimedOut(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, [userBinding, farm, member, farmMissing, memberMissing]);

  // Permission-gated subscriptions for operational collections
  useEffect(() => {
    if (!authReady || !user || !userBinding || !member || member.status !== 'active') return;
    const farmId = userBinding.farmId;
    const unsubs: (() => void)[] = [];
    const onErr = (err: Error) => setDataError(formatUserFriendlyError(err));
    const isDashboard = activeSection === 'dashboard';
    const isRecordsView = isDashboard || activeSection === 'production' || activeSection === 'batches' || activeSection === 'reports';
    const isFeedView = isDashboard || activeSection === 'production' || activeSection === 'purchases' || activeSection === 'batches' || activeSection === 'reports';

    // Active members can read reference setup, batches, and saved drafts
    unsubs.push(subscribePens(farmId, setPens, onErr));
    unsubs.push(subscribeFeedItems(farmId, setFeedItems, onErr));
    unsubs.push(subscribeFeedStock(farmId, setFeedStocks, onErr));
    unsubs.push(subscribeSalesUnits(farmId, setSalesUnits, onErr));
    unsubs.push(subscribeBatches(farmId, setBatches, onErr));
    unsubs.push(subscribeCarePlans(farmId, setCarePlans, onErr));
    unsubs.push(subscribeRecordDrafts(farmId, setDrafts, onErr));

    const canReadReports = hasPermission(member, 'reports', 'read') || member.role === 'owner';

    if (isRecordsView && (hasPermission(member, 'production', 'read') || canReadReports || hasPermission(member, 'eggStore', 'transfer'))) {
      unsubs.push(subscribeEggProduction(farmId, setProduction, onErr));
    }
    if (isFeedView && (hasPermission(member, 'feed', 'read') || canReadReports)) {
      unsubs.push(subscribeFeedPurchases(farmId, setPurchases, onErr));
      unsubs.push(subscribeFeedConsumption(farmId, setConsumptions, onErr));
      unsubs.push(subscribeFarmPurchases(farmId, setFarmPurchases, onErr));
    }
    if ((isDashboard || activeSection === 'sales' || activeSection === 'reports') && (hasPermission(member, 'sales', 'read') || canReadReports)) {
      unsubs.push(subscribeEggSales(farmId, setSales, onErr));
    }
    const canReadAccounts = member.role === 'owner' || canReadReports ||
      hasPermission(member, 'sales', 'read') || hasPermission(member, 'sales', 'create') ||
      hasPermission(member, 'feed', 'read') || hasPermission(member, 'feed', 'create');
    if (['accounts', 'sales', 'purchases'].includes(activeSection) && canReadAccounts) {
      unsubs.push(subscribeCustomers(farmId, setCustomers, onErr));
      unsubs.push(subscribeVendors(farmId, setVendors, onErr));
      unsubs.push(subscribeSalesInvoices(farmId, setSalesInvoices, onErr));
      unsubs.push(subscribePurchaseInvoices(farmId, setPurchaseInvoices, onErr));
      unsubs.push(subscribeAccountPayments(farmId, setAccountPayments, onErr));
    }
    const canUseEggStore = member.role === 'owner' || canReadReports ||
      hasPermission(member, 'eggStore', 'read') || hasPermission(member, 'eggStore', 'transfer') ||
      hasPermission(member, 'eggStore', 'receive') || hasPermission(member, 'eggStore', 'sort') ||
      hasPermission(member, 'eggStore', 'adjust') || hasPermission(member, 'eggStore', 'distribute') ||
      hasPermission(member, 'eggStore', 'dispose') || hasPermission(member, 'settings', 'edit');
    if ((isDashboard || activeSection === 'eggStore') && canUseEggStore) {
      unsubs.push(subscribeEggStoreSettings(farmId, setEggStoreSettings, onErr));
      unsubs.push(subscribeEggTransfers(farmId, setEggTransfers, onErr));
      unsubs.push(subscribeEggStoreReceipts(farmId, setEggStoreReceipts, onErr));
      unsubs.push(subscribeEggSortingBatches(farmId, setEggSortingBatches, onErr));
      unsubs.push(subscribeEggInventoryBalances(farmId, setEggInventoryBalances, onErr));
      unsubs.push(subscribeEggInventoryMovements(farmId, setEggInventoryMovements, onErr));
    }
    if (isRecordsView && (
      hasPermission(member, 'batches', 'read') ||
      hasPermission(member, 'production', 'read') ||
      canReadReports
    )) {
      unsubs.push(subscribeMortalityEntries(farmId, setMortalityEntries, onErr));
      unsubs.push(subscribeMedicationLogs(farmId, setMedicationLogs, onErr));
      unsubs.push(subscribeEnvironmentLogs(farmId, setEnvironmentLogs, onErr));
      unsubs.push(subscribeFarmReminders(farmId, setFarmReminders, onErr));
    }
    if (activeSection === 'settings' && (hasPermission(member, 'members', 'read') || member.role === 'owner')) {
      unsubs.push(subscribeMembers(farmId, setMembers, onErr));
      unsubs.push(subscribeInvites(farmId, setInvites, onErr));
    }
    if (activeSection === 'reports' && canReadReports) {
      unsubs.push(subscribeAuditLogs(farmId, setAuditLogs, onErr));
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [authReady, user, userBinding, member, activeSection]);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(formatUserFriendlyError(err));
    }
  };

  const handleRetry = () => {
    setDataError(null);
    setFarmLoaded(false);
    setMemberLoaded(false);
    setFarmMissing(false);
    setMemberMissing(false);
    setLoadTimedOut(false);
    setReloadSeq((s) => s + 1);
    if (user) {
      void loadBinding(user);
    }
  };

  const handleResetBinding = async () => {
    if (!user) return;
    try {
      await clearUserBinding(user.uid);
      setUserBinding(null);
      setFarm(null);
      setMember(null);
      setFarmLoaded(false);
      setMemberLoaded(false);
      setFarmMissing(false);
      setMemberMissing(false);
      setLoadTimedOut(false);
      setDataError(null);
      if (user.email) {
        const invite = await getPendingInviteForEmail(user.email);
        setPendingInvite(invite);
      }
    } catch (err) {
      setDataError(formatUserFriendlyError(err));
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    setActiveSection('dashboard');
    setDailyInitialSubTab('egg');
    setMortalityInitialBatchId(undefined);
    setMortalityAutoOpenModal(false);
    setFarm(null);
    setMember(null);
    setFarmLoaded(false);
    setMemberLoaded(false);
    setFarmMissing(false);
    setMemberMissing(false);
    setLoadTimedOut(false);
    setDataError(null);
  };

  const handleOpenMortality = (batchId?: string, openModal: boolean = false) => {
    setDailyInitialSubTab('mortality');
    setMortalityInitialBatchId(batchId);
    setMortalityAutoOpenModal(openModal);
    setActiveSection('production');
  };

  const handleSelectSection = (section: NavSection) => {
    if (section === 'production') {
      setDailyInitialSubTab('egg');
      setMortalityInitialBatchId(undefined);
      setMortalityAutoOpenModal(false);
    }
    setActiveSection(section);
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

  const handleRejectInvite = async (invite: PendingInvite, reason: string) => {
    if (!user) return;
    await rejectPendingInvite({ user, invite, reason });
    setPendingInvite(null);
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
        onRejectInvite={handleRejectInvite}
        onSignOut={handleSignOut}
      />
    );
  }

  if (!farm || !member) {
    const isMissing = farmMissing || memberMissing;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-800">
            {isMissing ? (
              <Building2 className="h-6 w-6 text-amber-600" />
            ) : (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-800 border-t-transparent" />
            )}
          </div>

          <div>
            <h1 className="font-display text-base font-semibold text-slate-900">
              {isMissing ? 'Farm Workspace Not Found' : 'Loading Farm Workspace'}
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {isMissing
                ? farmMissing
                  ? `The farm associated with this account (ID: ${userBinding.farmId}) could not be found in the database. It may have been removed or reset.`
                  : `Your membership record in farm "${farm?.name || userBinding.farmId}" could not be found or has not been activated.`
                : loadTimedOut
                ? 'Connecting to the farm workspace is taking longer than expected. You can retry or reset your workspace link below.'
                : 'Fetching farm configuration and membership permissions...'}
            </p>
          </div>

          {dataError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 text-left">
              {dataError}
            </div>
          )}

          {/* Diagnostic Info: keep identifiers out of the primary error presentation. */}
          <details className="rounded-lg border border-slate-200 bg-slate-50 text-left text-[11px] text-slate-600">
            <summary className="cursor-pointer select-none px-3 py-2 font-medium text-slate-600 hover:text-slate-900">
              Technical details
            </summary>
            <div className="space-y-1 border-t border-slate-200 px-3 py-3">
            <div className="flex justify-between">
              <span className="font-medium text-slate-500">Account:</span>
              <span className="font-mono truncate max-w-[200px]">{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium text-slate-500">Farm ID:</span>
              <span className="font-mono">{userBinding.farmId}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium text-slate-500">Farm Record:</span>
              <span>{farmLoaded ? (farm ? 'Found' : 'Not found in database') : 'Connecting...'}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium text-slate-500">Member Record:</span>
              <span>{memberLoaded ? (member ? 'Active' : 'Not found in database') : 'Connecting...'}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium text-slate-500">Sync Status:</span>
              <span className="capitalize">{syncState}</span>
            </div>
            </div>
          </details>

          <div className="flex flex-col gap-2 pt-2">
            {(isMissing || loadTimedOut) && (
              <button
                type="button"
                onClick={handleResetBinding}
                className="w-full rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 transition-colors"
              >
                Create or Link Another Farm
              </button>
            )}

            <button
              type="button"
              onClick={handleRetry}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry Connection</span>
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              Sign Out
            </button>
          </div>
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
      syncState={syncState}
      pendingProductionCount={new Set(production.filter((entry) => entry.status === 'PENDING' && !entry.isVoided).map((entry) => entry.parentId || entry.id)).size}
      dueReminderCount={farmReminders.filter((reminder) => {
        const batch = batches.find((item) => item.id === reminder.batchId);
        const assigned = member.role === 'owner' || !member.assignedPenIds?.length || member.assignedPenIds.includes(reminder.penId);
        return assigned && batch?.status === 'active' && reminder.status === 'pending' && reminder.dueDate <= formatDateInTimezone(new Date(), farm.timezone);
      }).length}
      onSelectSection={handleSelectSection}
      onSignOut={handleSignOut}
    >
      <Suspense
        fallback={
          <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-stone-200 bg-white/70 p-8">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-800 border-t-transparent" />
              <p className="mt-3 text-sm font-medium text-stone-700">Loading this farm view…</p>
              <p className="mt-1 text-xs text-stone-500">Cached information will appear as soon as it is available.</p>
            </div>
          </div>
        }
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
          mortalityEntries={mortalityEntries}
          onNavigate={handleSelectSection}
        />
      )}

      {activeSection === 'fishery' && <FisheryView />}
      {activeSection === 'crops' && <CropsView />}
      {activeSection === 'livestock' && <LivestockView />}

      {activeSection === 'production' && (
        <DailyProductionView
          farm={farm}
          member={member}
          batches={batches}
          feedItems={feedItems}
          feedStocks={feedStocks}
          feedPurchases={purchases}
          production={production}
          consumptions={consumptions}
          medicationLogs={medicationLogs}
          mortalityEntries={mortalityEntries}
          environmentLogs={environmentLogs}
          drafts={drafts}
          farmReminders={farmReminders}
          initialSubTab={dailyInitialSubTab}
          initialBatchFilter={mortalityInitialBatchId}
          autoOpenRecordModal={mortalityAutoOpenModal}
          onConsumedAutoOpen={() => setMortalityAutoOpenModal(false)}
          onBackToBatches={() => setActiveSection('batches')}
        />
      )}

      {activeSection === 'eggStore' && (
        <EggStoreView
          farm={farm}
          member={member}
          pens={pens}
          production={production}
          settings={eggStoreSettings}
          transfers={eggTransfers}
          receipts={eggStoreReceipts}
          sortingBatches={eggSortingBatches}
          balances={eggInventoryBalances}
          movements={eggInventoryMovements}
        />
      )}

      {activeSection === 'purchases' && (
        <PurchasesView
          farm={farm}
          member={member}
          batches={batches}
          feedItems={feedItems}
          feedStocks={feedStocks}
          feedPurchases={purchases}
          farmPurchases={farmPurchases}
          drafts={drafts}
          vendors={vendors}
          purchaseInvoices={purchaseInvoices}
        />
      )}

      {activeSection === 'sales' && (
        <SalesView
          farm={farm}
          member={member}
          batches={batches}
          salesUnits={salesUnits}
          sales={sales}
          customers={customers}
          salesInvoices={salesInvoices}
          eggStoreSettings={eggStoreSettings}
          inventoryBalances={eggInventoryBalances}
        />
      )}

      {activeSection === 'accounts' && (
        <AccountsView
          farm={farm}
          member={member}
          customers={customers}
          vendors={vendors}
          salesInvoices={salesInvoices}
          purchaseInvoices={purchaseInvoices}
          payments={accountPayments}
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
          sales={sales}
          farmPurchases={farmPurchases}
          mortalityEntries={mortalityEntries}
          carePlans={carePlans}
          onOpenMortality={handleOpenMortality}
        />
      )}

      {activeSection === 'reports' && (
        <ReportsView
          farm={farm}
          member={member}
          batches={batches}
          feedItems={feedItems}
          feedStocks={feedStocks}
          mortalityEntries={mortalityEntries}
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
          carePlans={carePlans}
        />
      )}
      </Suspense>
    </AppShell>
  );
}
