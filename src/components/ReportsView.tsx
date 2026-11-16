import React, { useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import {
  DATE_FILTER_PRESETS,
  DEFAULT_BAG_WEIGHT_KG,
  calculateBatchMortalityStats,
  downloadCsv,
  formatDateInTimezone,
  formatEggCountInCrates,
  formatIsoDateDisplay,
  formatGramsToKgAndBags,
  formatNgn,
  hasPermission,
  resolveDateRange,
} from '../domain/calculations.ts';
import { useDateRangeAnalytics } from '../hooks/useDateRangeAnalytics.ts';
import { PURCHASE_CATEGORY_LABEL } from '../services/purchasesService.ts';
import type {
  AuditLog,
  DateFilterPreset,
  Farm,
  FarmMember,
  FeedItem,
  FeedStock,
  MortalityEntry,
  PoultryBatch,
  PurchaseCategory,
} from '../types/farm.ts';

interface ReportsViewProps {
  farm: Farm;
  member: FarmMember;
  batches: PoultryBatch[];
  feedItems: FeedItem[];
  feedStocks: FeedStock[];
  mortalityEntries: MortalityEntry[];
  auditLogs: AuditLog[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  farm,
  member,
  batches,
  feedItems,
  feedStocks,
  mortalityEntries,
  auditLogs,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const [reportTab, setReportTab] = useState<
    'production' | 'feed' | 'purchases' | 'sales' | 'mortality' | 'audit'
  >('production');
  const [preset, setPreset] = useState<DateFilterPreset>('month');
  const [customStart, setCustomStart] = useState(`${todayStr.slice(0, 7)}-01`);
  const [customEnd, setCustomEnd] = useState(todayStr);
  const [batchFilter, setBatchFilter] = useState('all');
  const [feedFilter, setFeedFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('');

  const canExport = hasPermission(member, 'reports', 'export');
  const canReadProd = hasPermission(member, 'production', 'read') || hasPermission(member, 'reports', 'read');
  const canReadFeed = hasPermission(member, 'feed', 'read') || hasPermission(member, 'reports', 'read');
  const canReadSales = hasPermission(member, 'sales', 'read') || hasPermission(member, 'reports', 'read');
  const canReadMortality =
    hasPermission(member, 'batches', 'read') ||
    hasPermission(member, 'production', 'read') ||
    hasPermission(member, 'reports', 'read');
  const canReadAudit = member.role === 'owner' || hasPermission(member, 'reports', 'read');

  const { startDate, endDate } = useMemo(
    () => resolveDateRange(preset, farm.timezone, customStart, customEnd),
    [preset, farm.timezone, customStart, customEnd]
  );

  const {
    production,
    purchases,
    farmPurchases,
    consumptions,
    sales,
    mortality,
    medicationLogs,
    environmentLogs,
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
    canReadMortality,
    canReadMedication: canReadProd || canReadMortality,
    canReadEnvironment: canReadProd || canReadMortality,
    canReadFarmPurchases: canReadFeed,
    includePurchases: true,
  });

  const handleSelectPreset = (nextPreset: DateFilterPreset) => {
    setPreset(nextPreset);
    if (nextPreset !== 'custom') {
      const resolved = resolveDateRange(nextPreset, farm.timezone);
      setCustomStart(resolved.startDate);
      setCustomEnd(resolved.endDate);
    }
  };

  // Production Report Data
  const filteredProd = useMemo(() => {
    if (!canReadProd) return [];
    return production.filter(
      (p) =>
        !p.isVoided &&
        p.transactionDate >= startDate &&
        p.transactionDate <= endDate &&
        (batchFilter === 'all' || p.batchId === batchFilter)
    );
  }, [production, startDate, endDate, batchFilter, canReadProd]);

  const prodByBatch = useMemo(() => {
    const map = new Map<
      string,
      {
        batchCode: string;
        penName: string;
        entries: number;
        intact: number;
        cracked: number;
        damaged: number;
        total: number;
      }
    >();
    for (const p of filteredProd) {
      const cur = map.get(p.batchId) || {
        batchCode: p.batchCodeSnapshot,
        penName: p.penNameSnapshot,
        entries: 0,
        intact: 0,
        cracked: 0,
        damaged: 0,
        total: 0,
      };
      cur.entries += 1;
      cur.intact += p.intactEggs;
      cur.cracked += p.crackedEggs;
      cur.damaged += p.damagedEggs;
      cur.total += p.totalEggs;
      map.set(p.batchId, cur);
    }
    return Array.from(map.values());
  }, [filteredProd]);

  // Feed Report Data
  const filteredPurchases = useMemo(() => {
    if (!canReadFeed) return [];
    return purchases.filter(
      (p) =>
        !p.isVoided &&
        p.transactionDate >= startDate &&
        p.transactionDate <= endDate &&
        (feedFilter === 'all' || p.feedItemId === feedFilter)
    );
  }, [purchases, startDate, endDate, feedFilter, canReadFeed]);

  const filteredConsumptions = useMemo(() => {
    if (!canReadFeed) return [];
    return consumptions.filter(
      (c) =>
        !c.isVoided &&
        c.transactionDate >= startDate &&
        c.transactionDate <= endDate &&
        (feedFilter === 'all' || c.feedItemId === feedFilter) &&
        (batchFilter === 'all' || c.batchId === batchFilter)
    );
  }, [consumptions, startDate, endDate, feedFilter, batchFilter, canReadFeed]);

  // Sales Report Data
  const filteredSales = useMemo(() => {
    if (!canReadSales) return [];
    const cust = customerFilter.trim().toLowerCase();
    return sales.filter(
      (s) =>
        !s.isVoided &&
        s.transactionDate >= startDate &&
        s.transactionDate <= endDate &&
        (!cust || s.customerName.toLowerCase().includes(cust))
    );
  }, [sales, startDate, endDate, customerFilter, canReadSales]);

  const salesByUnit = useMemo(() => {
    const map = new Map<string, { unitName: string; qty: number; eggs: number; revenue: number }>();
    for (const s of filteredSales) {
      const cur = map.get(s.unitNameSnapshot) || {
        unitName: s.unitNameSnapshot,
        qty: 0,
        eggs: 0,
        revenue: 0,
      };
      cur.qty += s.quantity;
      cur.eggs += s.totalEggsEquivalent;
      cur.revenue += s.totalAmountNgn;
      map.set(s.unitNameSnapshot, cur);
    }
    return Array.from(map.values());
  }, [filteredSales]);

  // Mortality Report Data
  const filteredMortality = useMemo(() => {
    if (!canReadMortality) return [];
    return mortality.filter(
      (m) =>
        !m.isVoided &&
        m.transactionDate >= startDate &&
        m.transactionDate <= endDate &&
        (batchFilter === 'all' || m.batchId === batchFilter)
    );
  }, [mortality, startDate, endDate, batchFilter, canReadMortality]);

  const mortalityByBatch = useMemo(() => {
    const map = new Map<
      string,
      {
        batchId: string;
        batchCode: string;
        penName: string;
        entries: number;
        morning: number;
        afternoon: number;
        night: number;
        periodLosses: number;
      }
    >();
    for (const m of filteredMortality) {
      const cur = map.get(m.batchId) || {
        batchId: m.batchId,
        batchCode: m.batchCodeSnapshot,
        penName: m.penNameSnapshot,
        entries: 0,
        morning: 0,
        afternoon: 0,
        night: 0,
        periodLosses: 0,
      };
      cur.entries += 1;
      cur.periodLosses += m.mortalityCount;
      if (m.timeOfDay === 'morning') cur.morning += m.mortalityCount;
      else if (m.timeOfDay === 'afternoon') cur.afternoon += m.mortalityCount;
      else if (m.timeOfDay === 'night') cur.night += m.mortalityCount;
      map.set(m.batchId, cur);
    }
    return Array.from(map.values()).map((row) => {
      const batch = batches.find((b) => b.id === row.batchId);
      const stats = batch ? calculateBatchMortalityStats(batch, mortalityEntries) : null;
      return {
        ...row,
        initialCount: stats?.initialCount ?? 0,
        survivingBirds: stats?.survivingBirds ?? 0,
        survivalRatePct: stats?.survivalRatePct ?? 0,
      };
    });
  }, [filteredMortality, batches, mortalityEntries]);

  const mortalityByReason = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of filteredMortality) {
      map.set(m.reasonCategory, (map.get(m.reasonCategory) || 0) + m.mortalityCount);
    }
    return Array.from(map.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredMortality]);

  const filteredMedications = useMemo(() => {
    if (!canReadProd && !canReadMortality) return [];
    return medicationLogs.filter(
      (m) =>
        !m.isVoided &&
        m.transactionDate >= startDate &&
        m.transactionDate <= endDate &&
        (batchFilter === 'all' || m.batchId === batchFilter)
    );
  }, [medicationLogs, startDate, endDate, batchFilter, canReadProd, canReadMortality]);

  const filteredEnvironment = useMemo(() => {
    if (!canReadProd && !canReadMortality) return [];
    return environmentLogs.filter(
      (e) =>
        !e.isVoided &&
        e.transactionDate >= startDate &&
        e.transactionDate <= endDate &&
        (batchFilter === 'all' || e.batchId === batchFilter)
    );
  }, [environmentLogs, startDate, endDate, batchFilter, canReadProd, canReadMortality]);

  const filteredFarmPurchases = useMemo(() => {
    if (!canReadFeed) return [];
    return farmPurchases.filter(
      (p) =>
        !p.isVoided &&
        p.transactionDate >= startDate &&
        p.transactionDate <= endDate &&
        (batchFilter === 'all' || p.batchId === batchFilter)
    );
  }, [farmPurchases, startDate, endDate, batchFilter, canReadFeed]);

  // Daily multi-entry aggregates across eggs, feed, mortality, medication, weight, temperature, humidity
  const dailyAggregates = useMemo(() => {
    const byDate = new Map<
      string,
      {
        date: string;
        eggPickups: number;
        intactEggs: number;
        crackedDamaged: number;
        totalEggs: number;
        feedKg: number;
        mortalityBirds: number;
        medEntries: number;
        weights: number[];
        temps: number[];
        humidities: number[];
      }
    >();

    const ensure = (d: string) => {
      if (!byDate.has(d)) {
        byDate.set(d, {
          date: d,
          eggPickups: 0,
          intactEggs: 0,
          crackedDamaged: 0,
          totalEggs: 0,
          feedKg: 0,
          mortalityBirds: 0,
          medEntries: 0,
          weights: [],
          temps: [],
          humidities: [],
        });
      }
      return byDate.get(d)!;
    };

    for (const p of filteredProd) {
      const row = ensure(p.transactionDate);
      row.eggPickups += 1;
      row.intactEggs += p.intactEggs;
      row.crackedDamaged += p.crackedEggs + p.damagedEggs;
      row.totalEggs += p.totalEggs;
    }
    for (const c of filteredConsumptions) {
      const row = ensure(c.transactionDate);
      row.feedKg += c.standardizedGrams / 1000;
    }
    for (const m of filteredMortality) {
      const row = ensure(m.transactionDate);
      row.mortalityBirds += m.mortalityCount;
    }
    for (const med of filteredMedications) {
      const row = ensure(med.transactionDate);
      row.medEntries += 1;
    }
    for (const env of filteredEnvironment) {
      const row = ensure(env.transactionDate);
      if (env.averageWeightGrams !== null) row.weights.push(env.averageWeightGrams);
      if (env.temperatureC !== null) row.temps.push(env.temperatureC);
      if (env.humidityPct !== null) row.humidities.push(env.humidityPct);
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    return Array.from(byDate.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((r) => ({
        ...r,
        avgWeightG: avg(r.weights),
        avgTempC: avg(r.temps),
        minTempC: r.temps.length > 0 ? Math.min(...r.temps) : null,
        maxTempC: r.temps.length > 0 ? Math.max(...r.temps) : null,
        avgHumidityPct: avg(r.humidities),
      }));
  }, [
    filteredProd,
    filteredConsumptions,
    filteredMortality,
    filteredMedications,
    filteredEnvironment,
  ]);

  const farmPurchasesByCategory = useMemo(() => {
    const map = new Map<PurchaseCategory, { category: PurchaseCategory; count: number; totalNgn: number }>();
    for (const p of filteredFarmPurchases) {
      const cur = map.get(p.category) || { category: p.category, count: 0, totalNgn: 0 };
      cur.count += 1;
      cur.totalNgn += p.totalCostNgn;
      map.set(p.category, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.totalNgn - a.totalNgn);
  }, [filteredFarmPurchases]);

  const pnlTotals = useMemo(() => {
    const eggSalesNgn = filteredSales.reduce((s, item) => s + item.totalAmountNgn, 0);
    const feedConsCostNgn = filteredConsumptions.reduce((s, item) => s + item.totalCostNgn, 0);
    const feedPurchasesNgn = filteredPurchases.reduce((s, item) => s + item.totalCostNgn, 0);
    const otherPurchasesNgn = filteredFarmPurchases.reduce((s, item) => s + item.totalCostNgn, 0);
    const netOperatingNgn = eggSalesNgn - feedConsCostNgn - otherPurchasesNgn;
    return {
      eggSalesNgn,
      feedConsCostNgn,
      feedPurchasesNgn,
      otherPurchasesNgn,
      netOperatingNgn,
    };
  }, [filteredSales, filteredConsumptions, filteredPurchases, filteredFarmPurchases]);

  const handleExportCsv = () => {
    if (!canExport) return;
    if (reportTab === 'production') {
      downloadCsv(
        [
          'Date',
          'Time',
          'Batch',
          'Pen',
          'Bird Age (Days)',
          'Crates',
          'Pieces',
          'Intact Eggs',
          'Cracked Eggs',
          'Damaged Eggs',
          'Total Collected',
          'Recorded By',
          'Remarks',
        ],
        filteredProd.map((p) => [
          p.transactionDate,
          p.transactionTime,
          p.batchCodeSnapshot,
          p.penNameSnapshot,
          p.birdAgeDaysAtTransaction,
          p.crates,
          p.pieces,
          p.intactEggs,
          p.crackedEggs,
          p.damagedEggs,
          p.totalEggs,
          p.createdByName,
          p.remarks,
        ]),
        `babagiwa_egg_production_${startDate}_to_${endDate}.csv`
      );
    } else if (reportTab === 'feed') {
      downloadCsv(
        [
          'Date',
          'Type',
          'Batch',
          'Pen',
          'Feed Type',
          'Brand',
          'Entered Qty',
          'Entered Unit',
          'Standardized kg',
          'Cost Snapshot (NGN)',
          'Source Purchase Date',
          'Recorded By',
        ],
        filteredConsumptions.map((c) => [
          c.transactionDate,
          'Consumption',
          c.batchCodeSnapshot,
          c.penNameSnapshot,
          c.feedTypeSnapshot,
          c.brandSnapshot,
          c.enteredQuantity,
          c.enteredUnit,
          (c.standardizedGrams / 1000).toFixed(3),
          c.totalCostNgn.toFixed(2),
          c.costSourcePurchaseDate,
          c.createdByName,
        ]),
        `babagiwa_feed_consumption_${startDate}_to_${endDate}.csv`
      );
    } else if (reportTab === 'sales') {
      downloadCsv(
        [
          'Date',
          'Time',
          'Customer',
          'Category',
          'Selling Unit',
          'Quantity',
          'Total Eggs',
          'Suggested Price (NGN)',
          'Unit Price (NGN)',
          'Overridden',
          'Total Amount (NGN)',
          'Payment Status',
          'Recorded By',
        ],
        filteredSales.map((s) => [
          s.transactionDate,
          s.transactionTime,
          s.customerName || 'Walk-in',
          s.eggCategory,
          s.unitNameSnapshot,
          s.quantity,
          s.totalEggsEquivalent,
          s.suggestedUnitPriceNgn.toFixed(2),
          s.unitPriceNgn.toFixed(2),
          s.priceOverridden ? 'Yes' : 'No',
          s.totalAmountNgn.toFixed(2),
          s.paymentStatus,
          s.createdByName,
        ]),
        `babagiwa_egg_sales_${startDate}_to_${endDate}.csv`
      );
    } else if (reportTab === 'mortality') {
      downloadCsv(
        [
          'Date',
          'Time of Day',
          'Batch',
          'Pen',
          'Bird Age (Days)',
          'Birds Lost',
          'Reason Category',
          'Reason Details',
          'Recorded By',
          'Remarks',
        ],
        filteredMortality.map((m) => [
          m.transactionDate,
          m.timeOfDay,
          m.batchCodeSnapshot,
          m.penNameSnapshot,
          m.birdAgeDaysAtTransaction,
          m.mortalityCount,
          m.reasonCategory,
          m.reasonDetail,
          m.createdByName,
          m.remarks,
        ]),
        `babagiwa_mortality_${startDate}_to_${endDate}.csv`
      );
    } else if (reportTab === 'purchases') {
      downloadCsv(
        [
          'Date',
          'Category',
          'Item / Expense',
          'Quantity',
          'Unit',
          'Unit Price (NGN)',
          'Total Cost (NGN)',
          'Batch',
          'Supplier',
          'Reference',
          'Recorded By',
          'Remarks',
        ],
        filteredFarmPurchases.map((p) => [
          p.transactionDate,
          PURCHASE_CATEGORY_LABEL[p.category] || p.category,
          p.itemName,
          p.quantity,
          p.unit,
          p.unitPriceNgn.toFixed(2),
          p.totalCostNgn.toFixed(2),
          p.batchCodeSnapshot || 'Farm-wide',
          p.supplier,
          p.reference,
          p.createdByName,
          p.remarks,
        ]),
        `babagiwa_farm_purchases_${startDate}_to_${endDate}.csv`
      );
    } else if (reportTab === 'audit') {
      downloadCsv(
        ['Entity Type', 'Entity ID', 'Action', 'Summary', 'Actor'],
        auditLogs.map((a) => [a.entityType, a.entityId, a.action, a.summary, a.actorName]),
        `babagiwa_audit_logs_${todayStr}.csv`
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Operational Reports &amp; Audit Trail
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            All metrics reflect aggregated non-voided transactions in timezone {farm.timezone}.
          </p>
        </div>

        {canExport && (
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4 text-emerald-800" />
            <span>Export Filtered CSV</span>
          </button>
        )}
      </div>

      {/* Report Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-lg border border-slate-200 bg-white p-1.5 w-full sm:w-fit">
        {[
          { id: 'production', label: 'Daily Production & Health', visible: canReadProd },
          { id: 'feed', label: 'Feed & Stock Report', visible: canReadFeed },
          { id: 'purchases', label: 'Purchases & Farm P&L', visible: canReadFeed || canReadSales },
          { id: 'sales', label: 'Egg Sales Report', visible: canReadSales },
          { id: 'mortality', label: 'Mortality & Survival', visible: canReadMortality },
          { id: 'audit', label: 'Audit Trail', visible: canReadAudit },
        ]
          .filter((t) => t.visible)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setReportTab(t.id as typeof reportTab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                reportTab === t.id
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {/* Shared Filters */}
      {reportTab !== 'audit' && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
              {DATE_FILTER_PRESETS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectPreset(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    preset === tab.id
                      ? 'bg-emerald-800 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              {isFetching && (
                <span className="font-medium text-emerald-800 whitespace-nowrap">
                  Fetching records...
                </span>
              )}
              <button
                type="button"
                onClick={refetch}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin text-emerald-800' : ''}`}
                />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {fetchError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              <span>{fetchError}</span>
              <button
                type="button"
                onClick={refetch}
                className="rounded-md border border-red-300 bg-white px-2.5 py-1 font-medium text-red-800 hover:bg-red-100"
              >
                Retry
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="rep-start" className="block text-xs font-medium text-slate-600">
                Start Date
              </label>
              <input
                id="rep-start"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setPreset('custom');
                  setCustomStart(e.target.value);
                  setCustomEnd(endDate);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label htmlFor="rep-end" className="block text-xs font-medium text-slate-600">
                End Date
              </label>
              <input
                id="rep-end"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setPreset('custom');
                  setCustomStart(startDate);
                  setCustomEnd(e.target.value);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>

            {(reportTab === 'production' ||
              reportTab === 'feed' ||
              reportTab === 'purchases' ||
              reportTab === 'mortality') && (
              <div>
                <label htmlFor="rep-batch" className="block text-xs font-medium text-slate-600">
                  Batch Filter
                </label>
                <select
                  id="rep-batch"
                  value={batchFilter}
                  onChange={(e) => setBatchFilter(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                >
                  <option value="all">All Batches</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchCode} ({b.status})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {reportTab === 'feed' && (
              <div>
                <label htmlFor="rep-feed" className="block text-xs font-medium text-slate-600">
                  Feed Type / Brand
                </label>
                <select
                  id="rep-feed"
                  value={feedFilter}
                  onChange={(e) => setFeedFilter(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                >
                  <option value="all">All Feed Items</option>
                  {feedItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.feedType} — {i.brand}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {reportTab === 'sales' && (
              <div>
                <label htmlFor="rep-cust" className="block text-xs font-medium text-slate-600">
                  Customer Search
                </label>
                <input
                  id="rep-cust"
                  type="search"
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  placeholder="Filter by customer name..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Report Content */}
      {reportTab === 'production' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Daily Production &amp; Environment Aggregates
                </h2>
                <p className="text-xs text-slate-500">
                  Multiple morning/afternoon/night recordings on the same date are summed (eggs, feed, mortality, meds) or averaged (weight, temperature, humidity).
                </p>
              </div>
              {canExport && dailyAggregates.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      [
                        'Date',
                        'Egg Pickups',
                        'Intact Eggs',
                        'Cracked/Damaged',
                        'Total Eggs',
                        'Feed Issued (kg)',
                        'Mortality Losses',
                        'Medication Logs',
                        'Avg Bird Weight (g)',
                        'Avg Temp (C)',
                        'Avg Humidity (%)',
                      ],
                      dailyAggregates.map((r) => [
                        r.date,
                        r.eggPickups,
                        r.intactEggs,
                        r.crackedDamaged,
                        r.totalEggs,
                        r.feedKg.toFixed(2),
                        r.mortalityBirds,
                        r.medEntries,
                        r.avgWeightG !== null ? r.avgWeightG.toFixed(0) : '',
                        r.avgTempC !== null ? r.avgTempC.toFixed(1) : '',
                        r.avgHumidityPct !== null ? r.avgHumidityPct.toFixed(1) : '',
                      ]),
                      `babagiwa_daily_aggregates_${startDate}_to_${endDate}.csv`
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-800" />
                  <span>Export Daily Aggregates</span>
                </button>
              )}
            </div>

            {dailyAggregates.length === 0 ? (
              <p className="py-4 text-xs text-slate-500">
                No daily production, feed, medication, mortality, or environment entries in selected range.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto touch-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 font-medium">Date</th>
                      <th className="py-2 text-right font-medium">Pickups</th>
                      <th className="py-2 text-right font-medium">Total Eggs</th>
                      <th className="py-2 text-right font-medium">Feed (kg)</th>
                      <th className="py-2 text-right font-medium">Mortality</th>
                      <th className="py-2 text-right font-medium">Meds</th>
                      <th className="py-2 text-right font-medium">Avg Weight</th>
                      <th className="py-2 text-right font-medium">Temp °C</th>
                      <th className="py-2 text-right font-medium">Humidity %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {dailyAggregates.map((row) => (
                      <tr key={row.date} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-2 font-semibold text-slate-900">{formatIsoDateDisplay(row.date)}</td>
                        <td className="py-2.5 text-right text-slate-600">{row.eggPickups}</td>
                        <td className="py-2.5 text-right font-semibold text-emerald-800">
                          {formatEggCountInCrates(row.totalEggs)}
                        </td>
                        <td className="py-2.5 text-right text-slate-800">{row.feedKg.toFixed(2)}</td>
                        <td className="py-2.5 text-right text-red-700">
                          {row.mortalityBirds > 0 ? row.mortalityBirds.toLocaleString() : '0'}
                        </td>
                        <td className="py-2.5 text-right text-slate-700">{row.medEntries}</td>
                        <td className="py-2.5 text-right text-slate-700">
                          {row.avgWeightG !== null ? `${row.avgWeightG.toFixed(0)} g` : '—'}
                        </td>
                        <td className="py-2.5 text-right text-slate-700">
                          {row.avgTempC !== null
                            ? row.minTempC !== row.maxTempC
                              ? `${row.avgTempC.toFixed(1)}° (${row.minTempC?.toFixed(0)}–${row.maxTempC?.toFixed(0)})`
                              : `${row.avgTempC.toFixed(1)}°`
                            : '—'}
                        </td>
                        <td className="py-2.5 text-right text-slate-700">
                          {row.avgHumidityPct !== null ? `${row.avgHumidityPct.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Production Breakdown by Batch (Transaction Totals)
            </h2>
            {prodByBatch.length === 0 ? (
              <p className="py-4 text-xs text-slate-500">No production records in selected range.</p>
            ) : (
              <div className="mt-3 overflow-x-auto touch-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 font-medium">Batch / Pen</th>
                      <th className="py-2 text-right font-medium">Pickups</th>
                      <th className="py-2 text-right font-medium">Intact</th>
                      <th className="py-2 text-right font-medium">Cracked</th>
                      <th className="py-2 text-right font-medium">Damaged</th>
                      <th className="py-2 text-right font-medium">Total Collected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {prodByBatch.map((row) => (
                      <tr key={row.batchCode}>
                        <td className="py-2.5 font-sans">
                          <span className="font-semibold text-slate-900">{row.batchCode}</span> ·{' '}
                          <span className="text-slate-500">{row.penName}</span>
                        </td>
                        <td className="py-2.5 text-right">{row.entries}</td>
                        <td className="py-2.5 text-right text-emerald-800">
                          {formatEggCountInCrates(row.intact)}
                        </td>
                        <td className="py-2.5 text-right text-amber-700">
                          {formatEggCountInCrates(row.cracked)}
                        </td>
                        <td className="py-2.5 text-right text-red-700">
                          {formatEggCountInCrates(row.damaged)}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-slate-900">
                          {formatEggCountInCrates(row.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {filteredMedications.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Medication &amp; Vaccination Logs ({filteredMedications.length})
              </h2>
              <div className="mt-3 overflow-x-auto touch-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 font-medium">Date / Shift</th>
                      <th className="py-2 font-medium">Batch</th>
                      <th className="py-2 font-medium">Treatment</th>
                      <th className="py-2 font-medium">Dosage &amp; Route</th>
                      <th className="py-2 font-medium">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMedications.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2 font-mono text-slate-700">
                          {formatIsoDateDisplay(m.transactionDate)} ({m.timeOfDay})
                        </td>
                        <td className="py-2 font-mono text-slate-900">{m.batchCodeSnapshot}</td>
                        <td className="py-2">
                          <span className="font-semibold text-slate-900">{m.medicationName}</span>{' '}
                          <span className="capitalize text-slate-500">({m.treatmentType})</span>
                        </td>
                        <td className="py-2 text-slate-700">
                          {m.dosage} · {m.administrationRoute}
                        </td>
                        <td className="py-2 text-slate-600">{m.createdByName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {reportTab === 'purchases' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 tabular-nums">
            <div>
              <p className="text-xs text-slate-500">Egg Sales Revenue (Period)</p>
              <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                {formatNgn(pnlTotals.eggSalesNgn)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Feed Consumption Cost (Locked)</p>
              <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                {formatNgn(pnlTotals.feedConsCostNgn)}
              </p>
              <p className="text-[11px] text-slate-500">
                Feed stock-in cash: {formatNgn(pnlTotals.feedPurchasesNgn)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Medication &amp; General Purchases</p>
              <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                {formatNgn(pnlTotals.otherPurchasesNgn)}
              </p>
              <p className="text-[11px] text-slate-500">
                {filteredFarmPurchases.length} purchase records
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Net Operating Result (Period)</p>
              <p
                className={`mt-1 font-mono text-lg font-bold ${
                  pnlTotals.netOperatingNgn >= 0 ? 'text-emerald-800' : 'text-red-700'
                }`}
              >
                {formatNgn(pnlTotals.netOperatingNgn)}
              </p>
              <p className="text-[11px] text-slate-500">
                Egg sales minus feed used &amp; general purchases
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Non-Feed Purchases Breakdown by Category
            </h2>
            {farmPurchasesByCategory.length === 0 ? (
              <p className="py-4 text-xs text-slate-500">
                No medication or general farm purchases recorded in selected range.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto touch-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 font-medium">Category</th>
                      <th className="py-2 text-right font-medium">Entries</th>
                      <th className="py-2 text-right font-medium">Total Cost (NGN)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {farmPurchasesByCategory.map((row) => (
                      <tr key={row.category}>
                        <td className="py-2.5 font-medium text-slate-900">
                          {PURCHASE_CATEGORY_LABEL[row.category] || row.category}
                        </td>
                        <td className="py-2.5 text-right font-mono text-slate-700">{row.count}</td>
                        <td className="py-2.5 text-right font-mono font-semibold text-slate-900">
                          {formatNgn(row.totalNgn)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {filteredFarmPurchases.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Medication &amp; General Purchases Ledger ({filteredFarmPurchases.length})
              </h2>
              <div className="mt-3 overflow-x-auto touch-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 font-medium">Date</th>
                      <th className="py-2 font-medium">Category</th>
                      <th className="py-2 font-medium">Item / Expense</th>
                      <th className="py-2 font-medium">Batch</th>
                      <th className="py-2 text-right font-medium">Qty / Unit</th>
                      <th className="py-2 text-right font-medium">Total (NGN)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {filteredFarmPurchases.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 font-mono text-slate-700">{formatIsoDateDisplay(p.transactionDate)}</td>
                        <td className="py-2 text-slate-600">
                          {PURCHASE_CATEGORY_LABEL[p.category] || p.category}
                        </td>
                        <td className="py-2 font-medium text-slate-900">{p.itemName}</td>
                        <td className="py-2 font-mono text-slate-600">
                          {p.batchCodeSnapshot || 'Farm-wide'}
                        </td>
                        <td className="py-2 text-right font-mono text-slate-700">
                          {p.quantity} {p.unit}
                        </td>
                        <td className="py-2 text-right font-mono font-semibold text-slate-900">
                          {formatNgn(p.totalCostNgn)}
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

      {reportTab === 'feed' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-xl border border-slate-200 bg-white p-4 tabular-nums">
            <div>
              <p className="text-xs text-slate-500">Period Purchases (Transaction Total)</p>
              <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                {(
                  filteredPurchases.reduce((s, p) => s + p.standardizedGrams, 0) / 1000
                ).toFixed(2)}{' '}
                kg
              </p>
              <p className="text-xs font-mono text-slate-600">
                {formatNgn(filteredPurchases.reduce((s, p) => s + p.totalCostNgn, 0))}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Period Consumption (Transaction Total)</p>
              <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                {(
                  filteredConsumptions.reduce((s, c) => s + c.standardizedGrams, 0) / 1000
                ).toFixed(2)}{' '}
                kg
              </p>
              <p className="text-xs font-mono text-emerald-800">
                Locked Cost: {formatNgn(filteredConsumptions.reduce((s, c) => s + c.totalCostNgn, 0))}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Current Stock On Hand (Balance)</p>
              <p className="mt-1 font-mono text-lg font-bold text-emerald-800">
                {(
                  feedStocks.reduce((s, st) => s + st.balanceGrams, 0) / 1000
                ).toFixed(2)}{' '}
                kg
              </p>
              <p className="text-xs text-slate-500">Across {feedStocks.length} feed items</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Current Stock Balances by Feed Item
            </h2>
            <div className="mt-3 overflow-x-auto touch-scroll">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Feed Type / Brand</th>
                    <th className="py-2 text-right font-medium">Balance (kg)</th>
                    <th className="py-2 text-right font-medium">Bags Equiv.</th>
                    <th className="py-2 text-right font-medium">Latest Purchase Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {feedStocks.map((st) => {
                    const item = feedItems.find((i) => i.id === st.feedItemId);
                    const formatted = formatGramsToKgAndBags(
                      st.balanceGrams,
                      item?.defaultBagWeightKg ?? DEFAULT_BAG_WEIGHT_KG
                    );
                    return (
                      <tr key={st.feedItemId}>
                        <td className="py-2.5">
                          <span className="font-semibold text-slate-900">{st.feedType}</span> ·{' '}
                          <span className="text-slate-500">{st.brand}</span>
                        </td>
                        <td className="py-2.5 text-right font-mono">{formatted.kgText}</td>
                        <td className="py-2.5 text-right font-mono text-slate-600">
                          {formatted.bagsText}
                        </td>
                        <td className="py-2.5 text-right font-mono text-slate-600">
                          {st.lastPurchaseDate || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {reportTab === 'sales' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Egg Sales Summary by Selling Unit (Transaction Totals)
          </h2>
          {salesByUnit.length === 0 ? (
            <p className="py-4 text-xs text-slate-500">No sales in selected date range.</p>
          ) : (
            <div className="mt-3 overflow-x-auto touch-scroll">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Selling Unit</th>
                    <th className="py-2 text-right font-medium">Units Sold</th>
                    <th className="py-2 text-right font-medium">Total Eggs Equiv.</th>
                    <th className="py-2 text-right font-medium">Revenue (NGN)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {salesByUnit.map((row) => (
                    <tr key={row.unitName}>
                      <td className="py-2.5 font-sans font-semibold text-slate-900">{row.unitName}</td>
                      <td className="py-2.5 text-right">{row.qty.toLocaleString()}</td>
                      <td className="py-2.5 text-right">{formatEggCountInCrates(row.eggs)}</td>
                      <td className="py-2.5 text-right font-semibold text-emerald-800">
                        {formatNgn(row.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {reportTab === 'mortality' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Mortality Breakdown by Batch &amp; Pen (Period + Cumulative Survival)
            </h2>
            {mortalityByBatch.length === 0 ? (
              <p className="py-4 text-xs text-slate-500">
                No mortality entries recorded in selected date range.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto touch-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 font-medium">Batch / Pen</th>
                      <th className="py-2 text-right font-medium">Entries</th>
                      <th className="py-2 text-right font-medium">Morning</th>
                      <th className="py-2 text-right font-medium">Afternoon</th>
                      <th className="py-2 text-right font-medium">Night</th>
                      <th className="py-2 text-right font-medium">Period Losses</th>
                      <th className="py-2 text-right font-medium">Cumulative Survival</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {mortalityByBatch.map((row) => (
                      <tr key={row.batchId}>
                        <td className="py-2.5 font-sans">
                          <span className="font-semibold text-slate-900">{row.batchCode}</span> ·{' '}
                          <span className="text-slate-500">{row.penName}</span>
                        </td>
                        <td className="py-2.5 text-right">{row.entries}</td>
                        <td className="py-2.5 text-right text-amber-800">{row.morning}</td>
                        <td className="py-2.5 text-right text-sky-800">{row.afternoon}</td>
                        <td className="py-2.5 text-right text-indigo-800">{row.night}</td>
                        <td className="py-2.5 text-right font-semibold text-red-700">
                          {row.periodLosses.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-emerald-800">
                          {row.survivalRatePct.toFixed(2)}% ({row.survivingBirds.toLocaleString()}/
                          {row.initialCount.toLocaleString()})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {mortalityByReason.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Period Losses by Reason for Death
              </h2>
              <div className="mt-3 overflow-x-auto touch-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 font-medium">Reason for Death</th>
                      <th className="py-2 text-right font-medium">Birds Lost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {mortalityByReason.map((r) => (
                      <tr key={r.reason}>
                        <td className="py-2 font-medium text-slate-900">{r.reason}</td>
                        <td className="py-2 text-right font-mono font-semibold text-red-700">
                          {r.count.toLocaleString()}
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

      {reportTab === 'audit' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {auditLogs.length === 0 ? (
            <p className="p-6 text-xs text-slate-500">No audit events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto touch-scroll">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Entity</th>
                    <th className="px-4 py-3 font-medium">Summary</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-[11px] font-semibold uppercase text-slate-700">
                        {log.action}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        {log.entityType}
                      </td>
                      <td className="px-4 py-3 text-slate-800">{log.summary}</td>
                      <td className="px-4 py-3 text-slate-600">{log.actorName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
