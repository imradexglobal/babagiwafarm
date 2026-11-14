import React, { useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import {
  DATE_FILTER_PRESETS,
  DEFAULT_BAG_WEIGHT_KG,
  downloadCsv,
  formatDateInTimezone,
  formatGramsToKgAndBags,
  formatNgn,
  hasPermission,
  resolveDateRange,
} from '../domain/calculations.ts';
import { useDateRangeAnalytics } from '../hooks/useDateRangeAnalytics.ts';
import type {
  AuditLog,
  DateFilterPreset,
  Farm,
  FarmMember,
  FeedItem,
  FeedStock,
  PoultryBatch,
} from '../types/farm.ts';

interface ReportsViewProps {
  farm: Farm;
  member: FarmMember;
  batches: PoultryBatch[];
  feedItems: FeedItem[];
  feedStocks: FeedStock[];
  auditLogs: AuditLog[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  farm,
  member,
  batches,
  feedItems,
  feedStocks,
  auditLogs,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const [reportTab, setReportTab] = useState<'production' | 'feed' | 'sales' | 'audit'>('production');
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
  const canReadAudit = member.role === 'owner' || hasPermission(member, 'reports', 'read');

  const { startDate, endDate } = useMemo(
    () => resolveDateRange(preset, farm.timezone, customStart, customEnd),
    [preset, farm.timezone, customStart, customEnd]
  );

  const {
    production,
    purchases,
    consumptions,
    sales,
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
            All metrics reflect persisted non-voided transactions in timezone {farm.timezone}.
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
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
        {[
          { id: 'production', label: 'Egg Production Report', visible: canReadProd },
          { id: 'feed', label: 'Feed & Cost Report', visible: canReadFeed },
          { id: 'sales', label: 'Egg Sales Report', visible: canReadSales },
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
            <div className="flex flex-wrap items-center gap-1.5">
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

            {(reportTab === 'production' || reportTab === 'feed') && (
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
            <h2 className="text-sm font-semibold text-slate-900">
              Production Breakdown by Batch (Transaction Totals)
            </h2>
            {prodByBatch.length === 0 ? (
              <p className="py-4 text-xs text-slate-500">No production records in selected range.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
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
                          {row.intact.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right text-amber-700">
                          {row.cracked.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right text-red-700">
                          {row.damaged.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-slate-900">
                          {row.total.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
            <div className="mt-3 overflow-x-auto">
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
            <div className="mt-3 overflow-x-auto">
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
                      <td className="py-2.5 text-right">{row.eggs.toLocaleString()}</td>
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

      {reportTab === 'audit' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {auditLogs.length === 0 ? (
            <p className="p-6 text-xs text-slate-500">No audit events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
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
