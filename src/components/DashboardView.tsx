import React, { useMemo, useState } from 'react';
import { ArrowRight, Calendar, Egg, Layers, RefreshCw, ShoppingBag, Wheat } from 'lucide-react';
import {
  DATE_FILTER_PRESETS,
  DEFAULT_BAG_WEIGHT_KG,
  EGGS_PER_CRATE,
  calculateBatchMortalityStats,
  formatDateInTimezone,
  formatEggCountInCrates,
  formatIsoDateDisplay,
  formatGramsToKgAndBags,
  formatNgn,
  hasPermission,
  resolveDateRange,
} from '../domain/calculations.ts';
import { useDateRangeAnalytics } from '../hooks/useDateRangeAnalytics.ts';
import type {
  DateFilterPreset,
  EggProductionEntry,
  EggSale,
  Farm,
  FarmMember,
  FeedConsumption,
  FeedItem,
  FeedStock,
  MortalityEntry,
  Pen,
  PoultryBatch,
  SalesUnit,
} from '../types/farm.ts';
import type { NavSection } from './AppShell.tsx';

interface DashboardViewProps {
  farm: Farm;
  member: FarmMember;
  pens: Pen[];
  batches: PoultryBatch[];
  feedItems: FeedItem[];
  feedStocks: FeedStock[];
  salesUnits: SalesUnit[];
  production: EggProductionEntry[];
  consumptions: FeedConsumption[];
  sales: EggSale[];
  mortalityEntries: MortalityEntry[];
  onNavigate: (section: NavSection) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  farm,
  member,
  pens,
  batches,
  feedItems,
  feedStocks,
  salesUnits,
  production,
  consumptions,
  sales,
  mortalityEntries,
  onNavigate,
}) => {
  const todayInTz = formatDateInTimezone(new Date(), farm.timezone);
  const [preset, setPreset] = useState<DateFilterPreset>('month');
  const [customStart, setCustomStart] = useState(todayInTz);
  const [customEnd, setCustomEnd] = useState(todayInTz);

  const canReadProd = hasPermission(member, 'production', 'read') || hasPermission(member, 'reports', 'read');
  const canReadFeed = hasPermission(member, 'feed', 'read') || hasPermission(member, 'reports', 'read');
  const canReadSales = hasPermission(member, 'sales', 'read') || hasPermission(member, 'reports', 'read');

  const { startDate, endDate } = useMemo(
    () => resolveDateRange(preset, farm.timezone, customStart, customEnd),
    [preset, farm.timezone, customStart, customEnd]
  );

  const {
    production: rangeProduction,
    consumptions: rangeConsumptions,
    sales: rangeSales,
    isFetching,
    fetchError,
    refetch,
  } = useDateRangeAnalytics({
    farmId: farm.farmId,
    preset,
    startDate,
    endDate,
    canReadProd,
    canReadFeed,
    canReadSales,
    includePurchases: false,
  });

  const filteredProd = useMemo(
    () =>
      canReadProd
        ? rangeProduction.filter(
            (p) => !p.isVoided && (p.status === undefined || p.status === 'APPROVED') && p.transactionDate >= startDate && p.transactionDate <= endDate
          )
        : [],
    [rangeProduction, startDate, endDate, canReadProd]
  );

  const filteredCons = useMemo(
    () =>
      canReadFeed
        ? rangeConsumptions.filter(
            (c) => !c.isVoided && c.transactionDate >= startDate && c.transactionDate <= endDate
          )
        : [],
    [rangeConsumptions, startDate, endDate, canReadFeed]
  );

  const filteredSales = useMemo(
    () =>
      canReadSales
        ? rangeSales.filter(
            (s) => !s.isVoided && s.transactionDate >= startDate && s.transactionDate <= endDate
          )
        : [],
    [rangeSales, startDate, endDate, canReadSales]
  );

  const prodTotals = useMemo(() => {
    return filteredProd.reduce(
      (acc, item) => {
        acc.crates += item.crates;
        acc.pieces += item.pieces;
        acc.intactEggs += item.intactEggs;
        acc.crackedEggs += item.crackedEggs;
        acc.damagedEggs += item.damagedEggs;
        acc.totalEggs += item.totalEggs;
        return acc;
      },
      { crates: 0, pieces: 0, intactEggs: 0, crackedEggs: 0, damagedEggs: 0, totalEggs: 0 }
    );
  }, [filteredProd]);

  const feedConsTotals = useMemo(() => {
    return filteredCons.reduce(
      (acc, item) => {
        acc.grams += item.standardizedGrams;
        acc.costNgn += item.totalCostNgn;
        return acc;
      },
      { grams: 0, costNgn: 0 }
    );
  }, [filteredCons]);

  const salesTotals = useMemo(() => {
    return filteredSales.reduce(
      (acc, item) => {
        acc.eggsEquivalent += item.totalEggsEquivalent;
        acc.revenueNgn += item.totalAmountNgn;
        return acc;
      },
      { eggsEquivalent: 0, revenueNgn: 0 }
    );
  }, [filteredSales]);

  const stockRows = useMemo(() => {
    const itemById = new Map(feedItems.map((i) => [i.id, i]));
    return feedStocks
      .map((s) => {
        const item = itemById.get(s.feedItemId);
        const bagWeight = item?.defaultBagWeightKg ?? DEFAULT_BAG_WEIGHT_KG;
        const formatted = formatGramsToKgAndBags(s.balanceGrams, bagWeight);
        return {
          ...s,
          bagWeight,
          ...formatted,
        };
      })
      .sort((a, b) => a.feedType.localeCompare(b.feedType));
  }, [feedStocks, feedItems]);

  const dailyReconciliation = useMemo(() => {
    const byDate = new Map<
      string,
      {
        date: string;
        intactEggs: number;
        crackedDamaged: number;
        feedGrams: number;
        feedCostNgn: number;
        salesEggs: number;
        salesRevenueNgn: number;
      }
    >();

    const ensure = (d: string) => {
      if (!byDate.has(d)) {
        byDate.set(d, {
          date: d,
          intactEggs: 0,
          crackedDamaged: 0,
          feedGrams: 0,
          feedCostNgn: 0,
          salesEggs: 0,
          salesRevenueNgn: 0,
        });
      }
      return byDate.get(d)!;
    };

    for (const p of filteredProd) {
      const row = ensure(p.transactionDate);
      row.intactEggs += p.intactEggs;
      row.crackedDamaged += p.crackedEggs + p.damagedEggs;
    }
    for (const c of filteredCons) {
      const row = ensure(c.transactionDate);
      row.feedGrams += c.standardizedGrams;
      row.feedCostNgn += c.totalCostNgn;
    }
    for (const s of filteredSales) {
      const row = ensure(s.transactionDate);
      row.salesEggs += s.totalEggsEquivalent;
      row.salesRevenueNgn += s.totalAmountNgn;
    }

    return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredProd, filteredCons, filteredSales]);

  const hasAnySetup = pens.length > 0 || batches.length > 0 || feedItems.length > 0 || salesUnits.length > 0;
  const hasAnyTransactions =
    production.length > 0 ||
    consumptions.length > 0 ||
    sales.length > 0 ||
    rangeProduction.length > 0 ||
    rangeConsumptions.length > 0 ||
    rangeSales.length > 0;
  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const activeBatchesCount = activeBatches.length;
  const activeFlockHealth = useMemo(() => {
    let initial = 0;
    let surviving = 0;
    for (const b of activeBatches) {
      const st = calculateBatchMortalityStats(b, mortalityEntries);
      initial += st.initialCount;
      surviving += st.survivingBirds;
    }
    const survivalPct = initial > 0 ? Math.round((surviving / initial) * 10000) / 100 : 0;
    return { initial, surviving, survivalPct };
  }, [activeBatches, mortalityEntries]);
  const normalizedIntactCrates = Math.floor(prodTotals.intactEggs / EGGS_PER_CRATE);
  const normalizedIntactRemPieces = prodTotals.intactEggs % EGGS_PER_CRATE;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Poultry Operations Dashboard
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Reconciled from persisted farm records · Period{' '}
            <span className="font-mono text-slate-700">
              {startDate} to {endDate}
            </span>{' '}
            · Timezone <span className="font-mono text-slate-700">{farm.timezone}</span>
            {isFetching && (
              <span className="ml-2 font-medium text-emerald-800">· Fetching records...</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1">
          {DATE_FILTER_PRESETS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPreset(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                preset === tab.id
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            onClick={refetch}
            disabled={isFetching}
            title="Refetch filtered records from Firebase"
            aria-label="Refresh dashboard records"
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin text-emerald-800' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {fetchError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
        >
          <span>{fetchError}</span>
          <button
            type="button"
            onClick={refetch}
            className="rounded-md border border-red-300 bg-white px-3 py-1 font-medium text-red-800 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <Calendar className="h-4 w-4 text-emerald-800" />
            <span>Custom Date Range ({farm.timezone})</span>
          </div>
          <div>
            <label htmlFor="dash-start" className="block text-xs text-slate-500">
              Start Date
            </label>
            <input
              id="dash-start"
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="dash-end" className="block text-xs text-slate-500">
              End Date
            </label>
            <input
              id="dash-end"
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono text-slate-900"
            />
          </div>
        </div>
      )}

      {/* Setup / Empty Farm Guidance */}
      {(!hasAnySetup || !hasAnyTransactions) && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            First-Time Farm Setup Checklist
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            No fabricated sample numbers are shown here. Complete the steps below to start recording
            real farm operations:
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition-colors"
            >
              <div>
                <p className="text-xs font-semibold text-slate-900">1. Configure Setup</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {pens.length} pens · {feedItems.length} feeds · {salesUnits.length} units
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('batches')}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition-colors"
            >
              <div>
                <p className="text-xs font-semibold text-slate-900">2. Place a Flock Batch</p>
                <p className="mt-0.5 text-xs text-slate-500">{activeBatchesCount} active batches</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('production')}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition-colors"
            >
              <div>
                <p className="text-xs font-semibold text-slate-900">3. Daily Records Hub</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {production.length} egg · {consumptions.length} feed entries
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('purchases')}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition-colors"
            >
              <div>
                <p className="text-xs font-semibold text-slate-900">4. Purchases &amp; Feed Stock</p>
                <p className="mt-0.5 text-xs text-slate-500">Record feed &amp; medication stock</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {/* Production Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              Egg Production (Period Total)
            </span>
            <Egg className="h-4 w-4 text-emerald-800" />
          </div>
          {canReadProd ? (
            <>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {formatEggCountInCrates(prodTotals.totalEggs)}
              </p>
              <div className="mt-2 space-y-1 text-xs text-slate-600 tabular-nums">
                <p>
                  Intact: {formatEggCountInCrates(prodTotals.intactEggs)} ({prodTotals.intactEggs.toLocaleString()} pcs)
                </p>
                <p className="text-slate-500">
                  Cracked: {formatEggCountInCrates(prodTotals.crackedEggs)} · Damaged: {formatEggCountInCrates(prodTotals.damagedEggs)}
                </p>
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Restricted by your production permissions.</p>
          )}
        </div>

        {/* Egg Sales Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Egg Sales (Period Total)</span>
            <ShoppingBag className="h-4 w-4 text-emerald-800" />
          </div>
          {canReadSales ? (
            <>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {formatNgn(salesTotals.revenueNgn)}
              </p>
              <div className="mt-2 space-y-1 text-xs text-slate-600 tabular-nums">
                <p>{formatEggCountInCrates(salesTotals.eggsEquivalent)} ({salesTotals.eggsEquivalent.toLocaleString()} pcs)</p>
                <p className="text-slate-500">{filteredSales.length} completed sale entries</p>
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Restricted by your sales permissions.</p>
          )}
        </div>

        {/* Feed Consumed Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              Feed Consumed (Period Total)
            </span>
            <Wheat className="h-4 w-4 text-emerald-800" />
          </div>
          {canReadFeed ? (
            <>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {(feedConsTotals.grams / 1000).toLocaleString('en-NG', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                kg
              </p>
              <div className="mt-2 space-y-1 text-xs text-slate-600 tabular-nums">
                <p>Locked Cost: {formatNgn(feedConsTotals.costNgn)}</p>
                <p className="text-slate-500">{filteredCons.length} stock-out entries</p>
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Restricted by your feed permissions.</p>
          )}
        </div>

        {/* Active Flocks Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Active Poultry Flocks</span>
            <Layers className="h-4 w-4 text-emerald-800" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {activeBatchesCount}
          </p>
          <div className="mt-2 space-y-1 text-xs text-slate-600 tabular-nums">
            <p>
              {activeFlockHealth.surviving.toLocaleString()} /{' '}
              {activeFlockHealth.initial.toLocaleString()} surviving{' '}
              {activeFlockHealth.initial > 0 && (
                <span className="font-semibold text-emerald-800">
                  ({activeFlockHealth.survivalPct.toFixed(1)}%)
                </span>
              )}
            </p>
            <p className="text-slate-500">{pens.filter((p) => p.status === 'active').length} active pens</p>
          </div>
        </div>
      </div>

      {/* Stock Balance & Daily Reconciliation */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Current Feed Stock Balance</h2>
              <p className="text-xs text-slate-500">Live store inventory (all dates)</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('purchases')}
              className="text-xs font-medium text-emerald-800 hover:underline whitespace-nowrap shrink-0"
            >
              Purchases &amp; Stock
            </button>
          </div>

          {!canReadFeed ? (
            <p className="py-6 text-xs text-slate-500">Feed stock restricted by permissions.</p>
          ) : stockRows.length === 0 ? (
            <p className="py-6 text-xs text-slate-500">
              No feed items configured yet. Add feed items in Farm Setup to track stock.
            </p>
          ) : (
            <>
            <div className="mt-3 hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Feed / Brand</th>
                    <th className="py-2 text-right font-medium">Stock (kg)</th>
                    <th className="py-2 text-right font-medium">Bags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {stockRows.map((row) => (
                    <tr key={row.feedItemId}>
                      <td className="py-2.5 pr-2">
                        <p className="font-medium text-slate-900">{row.feedType}</p>
                        <p className="text-slate-500">{row.brand}</p>
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono font-medium ${
                          row.balanceGrams <= 0 ? 'text-amber-700' : 'text-slate-900'
                        }`}
                      >
                        {row.kgText}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-600">
                        {row.bagsText}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 sm:hidden space-y-2">
              {stockRows.map((row) => (
                <div key={row.feedItemId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                  <div>
                    <p className="font-bold text-xs text-slate-900">{row.feedType}</p>
                    <p className="text-[11px] text-slate-500">{row.brand}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-xs font-bold ${row.balanceGrams <= 0 ? 'text-amber-700' : 'text-slate-900'}`}>{row.kgText}</p>
                    <p className="font-mono text-[11px] text-slate-500">{row.bagsText}</p>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Daily Activity Reconciliation ({formatIsoDateDisplay(startDate)} to {formatIsoDateDisplay(endDate)})
              </h2>
              <p className="text-xs text-slate-500">
                Aggregated from persisted non-voided transactions
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-medium text-emerald-800 hover:underline whitespace-nowrap shrink-0"
            >
              Full Reports
            </button>
          </div>

          {dailyReconciliation.length === 0 ? (
            <p className="py-6 text-xs text-slate-500">
              No transactions recorded inside this date range.
            </p>
          ) : (
            <>
            <div className="mt-3 hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 text-right font-medium">Intact Eggs</th>
                    <th className="py-2 text-right font-medium">Cracked/Dmg</th>
                    <th className="py-2 text-right font-medium">Feed (kg)</th>
                    <th className="py-2 text-right font-medium">Feed Cost</th>
                    <th className="py-2 text-right font-medium">Sales Rev.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {dailyReconciliation.slice(0, 14).map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-2 font-medium text-slate-900">{formatIsoDateDisplay(row.date)}</td>
                      <td className="py-2.5 text-right text-slate-800">
                        {formatEggCountInCrates(row.intactEggs)}
                      </td>
                      <td className="py-2.5 text-right text-slate-600">
                        {formatEggCountInCrates(row.crackedDamaged)}
                      </td>
                      <td className="py-2.5 text-right text-slate-800">
                        {(row.feedGrams / 1000).toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right text-slate-700">
                        {formatNgn(row.feedCostNgn)}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-emerald-800">
                        {formatNgn(row.salesRevenueNgn)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 sm:hidden space-y-2.5">
              {dailyReconciliation.slice(0, 10).map((row) => (
                <div key={row.date} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <span className="font-bold text-xs text-slate-900">{formatIsoDateDisplay(row.date)}</span>
                    <span className="font-mono font-bold text-xs text-emerald-800">{formatNgn(row.salesRevenueNgn)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block">Intact Eggs</span>
                      <span className="font-mono font-semibold text-slate-800">{formatEggCountInCrates(row.intactEggs)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block">Cracked / Dmg</span>
                      <span className="font-mono text-slate-700">{formatEggCountInCrates(row.crackedDamaged)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block">Feed Issued</span>
                      <span className="font-mono text-slate-800">{(row.feedGrams / 1000).toFixed(1)} kg</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block">Feed Cost</span>
                      <span className="font-mono text-slate-700">{formatNgn(row.feedCostNgn)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
