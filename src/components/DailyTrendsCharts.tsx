import React, { useEffect, useMemo, useRef, useState } from 'react';
import { area as d3Area, curveMonotoneX, line as d3Line, max as d3Max, scaleBand, scaleLinear } from 'd3';
import { Plus, TrendingUp } from 'lucide-react';
import { EGGS_PER_CRATE, formatEggCountInCrates, formatNgn, type DailyTrendPoint } from '../domain/calculations.ts';

interface DailyTrendsChartsProps {
  points: DailyTrendPoint[];
  canReadProd: boolean;
  canReadFeed: boolean;
  canCreateAny: boolean;
  scopedBatchLabel: string;
  onLogDailyEntry?: () => void;
}

type TrendChartMode = 'paired' | 'overlay';

const CHART_HEIGHT = 272;
const MARGIN_SINGLE = { top: 18, right: 16, bottom: 32, left: 52 };
const MARGIN_OVERLAY = { top: 18, right: 54, bottom: 32, left: 52 };

function useContainerWidth(initialWidth = 560) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(initialWidth);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

function formatAxisCount(val: number): string {
  if (val >= 1000) {
    const k = val / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(Math.round(val));
}

function formatAxisKg(val: number): string {
  if (val >= 1000) {
    return `${(val / 1000).toFixed(1)}t`;
  }
  return Number.isInteger(val) ? `${val}` : val.toFixed(1);
}

function formatCratesPieces(eggs: number): string {
  const crates = Math.floor(eggs / EGGS_PER_CRATE);
  const pcs = eggs % EGGS_PER_CRATE;
  return `${crates}c + ${pcs}p`;
}

export const DailyTrendsCharts: React.FC<DailyTrendsChartsProps> = ({
  points,
  canReadProd,
  canReadFeed,
  canCreateAny,
  scopedBatchLabel,
  onLogDailyEntry,
}) => {
  const [chartMode, setChartMode] = useState<TrendChartMode>('paired');
  const [hoveredEggDate, setHoveredEggDate] = useState<string | null>(null);
  const [hoveredFeedDate, setHoveredFeedDate] = useState<string | null>(null);
  const [hoveredOverlayDate, setHoveredOverlayDate] = useState<string | null>(null);

  const eggContainer = useContainerWidth(540);
  const feedContainer = useContainerWidth(540);
  const overlayContainer = useContainerWidth(960);

  const summary = useMemo(() => {
    let totalEggs = 0;
    let totalIntact = 0;
    let totalCrackedDamaged = 0;
    let eggActiveDays = 0;
    let totalFeedGrams = 0;
    let totalFeedCostNgn = 0;
    let feedActiveDays = 0;

    for (const pt of points) {
      totalEggs += pt.totalEggs;
      totalIntact += pt.intactEggs;
      totalCrackedDamaged += pt.crackedOrDamagedEggs;
      if (pt.totalEggs > 0) eggActiveDays += 1;
      totalFeedGrams += pt.feedGrams;
      totalFeedCostNgn += pt.feedCostNgn;
      if (pt.feedGrams > 0) feedActiveDays += 1;
    }

    const days = Math.max(1, points.length);
    const totalFeedKg = Math.round((totalFeedGrams / 1000) * 100) / 100;
    const avgEggsPerDay = Math.round(totalEggs / days);
    const avgFeedKgPerDay = Math.round((totalFeedKg / days) * 100) / 100;
    const intactPct = totalEggs > 0 ? Math.round((totalIntact / totalEggs) * 1000) / 10 : 0;
    const feedGramsPerEgg =
      totalEggs > 0 && totalFeedGrams > 0
        ? Math.round((totalFeedGrams / totalEggs) * 10) / 10
        : null;

    return {
      totalEggs,
      totalIntact,
      totalCrackedDamaged,
      eggActiveDays,
      avgEggsPerDay,
      intactPct,
      totalFeedKg,
      totalFeedCostNgn: Math.round(totalFeedCostNgn * 100) / 100,
      feedActiveDays,
      avgFeedKgPerDay,
      feedGramsPerEgg,
    };
  }, [points]);

  const effectiveMode: TrendChartMode =
    canReadProd && canReadFeed ? chartMode : 'paired';

  const hasAnyEggData = summary.totalEggs > 0;
  const hasAnyFeedData = summary.totalFeedKg > 0;
  const isCompletelyEmpty =
    (!canReadProd || !hasAnyEggData) && (!canReadFeed || !hasAnyFeedData);

  const dateWindowLabel =
    points.length >= 2
      ? `${points[0].displayDate} — ${points[points.length - 1].displayDate}`
      : '';

  // D3 computation: Egg Production Chart
  const eggSvg = useMemo(() => {
    const w = Math.max(280, eggContainer.width);
    const h = CHART_HEIGHT;
    const innerW = Math.max(120, w - MARGIN_SINGLE.left - MARGIN_SINGLE.right);
    const innerH = Math.max(100, h - MARGIN_SINGLE.top - MARGIN_SINGLE.bottom);

    const x = scaleBand<string>()
      .domain(points.map((d) => d.date))
      .range([0, innerW])
      .padding(0.32);

    const maxEggs = d3Max(points, (d) => d.totalEggs) ?? 0;
    const yMax = maxEggs > 0 ? Math.ceil(maxEggs * 1.15) : 100;
    const y = scaleLinear().domain([0, yMax]).nice(5).range([innerH, 0]);
    const yTicks = y.ticks(5);

    const totalLine =
      d3Line<DailyTrendPoint>()
        .x((d) => (x(d.date) ?? 0) + x.bandwidth() / 2)
        .y((d) => y(d.totalEggs))
        .curve(curveMonotoneX)(points) || '';

    return { w, h, innerW, innerH, x, y, yTicks, totalLine };
  }, [eggContainer.width, points]);

  // D3 computation: Feed Consumption Chart
  const feedSvg = useMemo(() => {
    const w = Math.max(280, feedContainer.width);
    const h = CHART_HEIGHT;
    const innerW = Math.max(120, w - MARGIN_SINGLE.left - MARGIN_SINGLE.right);
    const innerH = Math.max(100, h - MARGIN_SINGLE.top - MARGIN_SINGLE.bottom);

    const x = scaleBand<string>()
      .domain(points.map((d) => d.date))
      .range([0, innerW])
      .padding(0.32);

    const maxFeed = d3Max(points, (d) => d.feedKg) ?? 0;
    const yMax = maxFeed > 0 ? Math.ceil(maxFeed * 1.18) : 50;
    const y = scaleLinear().domain([0, yMax]).nice(5).range([innerH, 0]);
    const yTicks = y.ticks(5);

    const feedLine =
      d3Line<DailyTrendPoint>()
        .x((d) => (x(d.date) ?? 0) + x.bandwidth() / 2)
        .y((d) => y(d.feedKg))
        .curve(curveMonotoneX)(points) || '';

    const feedArea =
      d3Area<DailyTrendPoint>()
        .x((d) => (x(d.date) ?? 0) + x.bandwidth() / 2)
        .y0(innerH)
        .y1((d) => y(d.feedKg))
        .curve(curveMonotoneX)(points) || '';

    return { w, h, innerW, innerH, x, y, yTicks, feedLine, feedArea };
  }, [feedContainer.width, points]);

  // D3 computation: Combined Dual-Axis Overlay Chart
  const overlaySvg = useMemo(() => {
    const w = Math.max(320, overlayContainer.width);
    const h = 320;
    const innerW = Math.max(160, w - MARGIN_OVERLAY.left - MARGIN_OVERLAY.right);
    const innerH = Math.max(120, h - MARGIN_OVERLAY.top - MARGIN_OVERLAY.bottom);

    const x = scaleBand<string>()
      .domain(points.map((d) => d.date))
      .range([0, innerW])
      .padding(0.36);

    const maxEggs = d3Max(points, (d) => d.totalEggs) ?? 0;
    const yEggsMax = maxEggs > 0 ? Math.ceil(maxEggs * 1.15) : 100;
    const yEggs = scaleLinear().domain([0, yEggsMax]).nice(5).range([innerH, 0]);

    const maxFeed = d3Max(points, (d) => d.feedKg) ?? 0;
    const yFeedMax = maxFeed > 0 ? Math.ceil(maxFeed * 1.18) : 50;
    const yFeed = scaleLinear().domain([0, yFeedMax]).nice(5).range([innerH, 0]);

    const yEggTicks = yEggs.ticks(5);
    const yFeedTicks = yFeed.ticks(5);

    const feedLine =
      d3Line<DailyTrendPoint>()
        .x((d) => (x(d.date) ?? 0) + x.bandwidth() / 2)
        .y((d) => yFeed(d.feedKg))
        .curve(curveMonotoneX)(points) || '';

    return { w, h, innerW, innerH, x, yEggs, yFeed, yEggTicks, yFeedTicks, feedLine };
  }, [overlayContainer.width, points]);

  const hoveredEggPoint = points.find((p) => p.date === hoveredEggDate) || null;
  const hoveredFeedPoint = points.find((p) => p.date === hoveredFeedDate) || null;
  const hoveredOverlayPoint = points.find((p) => p.date === hoveredOverlayDate) || null;

  return (
    <div className="space-y-4">
      {/* Header Strip & Mode Toggle */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5 min-w-0">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              7-Day Production &amp; Feed Patterns
            </h2>
            <p className="text-xs text-slate-500">
              {dateWindowLabel} · Scope: <strong className="text-slate-700">{scopedBatchLabel}</strong> ·
              Excludes voided records
            </p>
          </div>
        </div>

        {canReadProd && canReadFeed && (
          <div className="inline-flex self-start rounded-lg border border-slate-200 bg-slate-50 p-1 sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setChartMode('paired')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                effectiveMode === 'paired'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Paired Charts
            </button>
            <button
              type="button"
              onClick={() => setChartMode('overlay')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                effectiveMode === 'overlay'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Combined Overlay
            </button>
          </div>
        )}
      </div>

      {/* 7-Day KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 tabular-nums">
        {canReadProd && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">7-Day Total Eggs</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-800">
              {summary.totalEggs.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 font-mono">
              {formatCratesPieces(summary.totalEggs)} · Avg {summary.avgEggsPerDay.toLocaleString()}/day
            </p>
          </div>
        )}

        {canReadProd && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Intact vs. Cracked/Dmg</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900">
              {summary.totalEggs > 0 ? `${summary.intactPct.toFixed(1)}%` : '—'}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 font-mono">
              {summary.totalIntact.toLocaleString()} intact ·{' '}
              <span className="text-amber-700">{summary.totalCrackedDamaged.toLocaleString()}</span> loss
            </p>
          </div>
        )}

        {canReadFeed && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">7-Day Feed Consumed</p>
            <p className="mt-1 font-mono text-2xl font-bold text-amber-800">
              {summary.totalFeedKg.toLocaleString('en-NG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              kg
            </p>
            <p className="mt-0.5 text-xs text-slate-600 font-mono">
              Avg {summary.avgFeedKgPerDay.toFixed(2)} kg/day · {formatNgn(summary.totalFeedCostNgn)}
            </p>
          </div>
        )}

        {canReadProd && canReadFeed && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">7-Day Feed Efficiency</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900">
              {summary.feedGramsPerEgg !== null ? `${summary.feedGramsPerEgg.toFixed(1)} g/egg` : '—'}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 font-mono">
              {summary.feedGramsPerEgg !== null
                ? `${((summary.feedGramsPerEgg * EGGS_PER_CRATE) / 1000).toFixed(2)} kg / crate`
                : `${summary.eggActiveDays}/7 egg days · ${summary.feedActiveDays}/7 feed days`}
            </p>
          </div>
        )}
      </div>

      {/* Empty State Callout */}
      {isCompletelyEmpty && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 sm:flex-row">
          <div>
            <p className="text-sm font-semibold text-amber-950">
              No egg production or feed consumption entries logged in the last 7 days
              {scopedBatchLabel !== 'All Batches' ? ` for ${scopedBatchLabel}` : ''}.
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              The 7-day charts below stay anchored to today; log a pickup or feeding issue to plot
              daily bars and trend curves.
            </p>
          </div>
          {canCreateAny && onLogDailyEntry && (
            <button
              type="button"
              onClick={onLogDailyEntry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-900 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Record Daily Entry</span>
            </button>
          )}
        </div>
      )}

      {/* Charts Area */}
      {effectiveMode === 'paired' ? (
        <div
          className={`grid grid-cols-1 gap-4 ${
            canReadProd && canReadFeed ? 'xl:grid-cols-2' : ''
          }`}
        >
          {/* D3 Chart 1: Daily Egg Production */}
          {canReadProd && (
            <section
              aria-label="Daily egg production 7-day chart"
              className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 min-w-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Daily Egg Production (Last 7 Days)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Stacked intact vs. cracked/damaged counts with daily trend curve
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs bg-emerald-800 inline-block" />
                    Intact
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs bg-amber-600 inline-block" />
                    Cracked/Dmg
                  </span>
                </div>
              </div>

              <div ref={eggContainer.ref} className="relative mt-3 w-full min-w-0">
                <svg
                  width={eggSvg.w}
                  height={eggSvg.h}
                  viewBox={`0 0 ${eggSvg.w} ${eggSvg.h}`}
                  role="img"
                  aria-label="Bar and trend chart of daily egg production over the last 7 days"
                  className="block w-full overflow-visible select-none"
                >
                  <g transform={`translate(${MARGIN_SINGLE.left},${MARGIN_SINGLE.top})`}>
                    {/* Horizontal gridlines & Y-axis labels */}
                    {eggSvg.yTicks.map((tick) => {
                      const ty = eggSvg.y(tick);
                      return (
                        <g key={tick} transform={`translate(0,${ty})`}>
                          <line
                            x1={0}
                            x2={eggSvg.innerW}
                            y1={0}
                            y2={0}
                            stroke="#e2e8f0"
                            strokeDasharray={tick === 0 ? undefined : '2 3'}
                          />
                          <text
                            x={-8}
                            y={3}
                            textAnchor="end"
                            className="fill-slate-500 font-mono text-[10px]"
                          >
                            {formatAxisCount(tick)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Stacked Bars per day */}
                    {points.map((pt) => {
                      const bx = eggSvg.x(pt.date) ?? 0;
                      const bw = eggSvg.x.bandwidth();
                      const yTotal = eggSvg.y(pt.totalEggs);
                      const yIntactTop = eggSvg.y(pt.intactEggs);
                      const intactH = Math.max(0, eggSvg.innerH - yIntactTop);
                      const crackedH = Math.max(0, yIntactTop - yTotal);
                      const isHovered = hoveredEggDate === pt.date;

                      return (
                        <g
                          key={pt.date}
                          onMouseEnter={() => setHoveredEggDate(pt.date)}
                          onMouseLeave={() => setHoveredEggDate(null)}
                          onFocus={() => setHoveredEggDate(pt.date)}
                          onBlur={() => setHoveredEggDate(null)}
                          tabIndex={0}
                          className="cursor-pointer outline-none"
                        >
                          {/* Full column hover hit target */}
                          <rect
                            x={bx - 4}
                            y={0}
                            width={bw + 8}
                            height={eggSvg.innerH}
                            fill={isHovered ? '#f1f5f9' : 'transparent'}
                            rx={4}
                          />

                          {/* Intact segment */}
                          {intactH > 0 && (
                            <rect
                              x={bx}
                              y={yIntactTop}
                              width={bw}
                              height={intactH}
                              fill={isHovered ? '#064e3b' : '#065f46'}
                              rx={crackedH > 0 ? 0 : 3}
                            />
                          )}

                          {/* Cracked / Damaged stacked top segment */}
                          {crackedH > 0 && (
                            <rect
                              x={bx}
                              y={yTotal}
                              width={bw}
                              height={crackedH}
                              fill="#d97706"
                              rx={3}
                            />
                          )}

                          {/* Zero-baseline subtle marker if nothing recorded */}
                          {pt.totalEggs === 0 && (
                            <line
                              x1={bx + 2}
                              x2={bx + bw - 2}
                              y1={eggSvg.innerH - 1}
                              y2={eggSvg.innerH - 1}
                              stroke="#cbd5e1"
                              strokeWidth={2}
                            />
                          )}

                          {/* X-axis tick label */}
                          <text
                            x={bx + bw / 2}
                            y={eggSvg.innerH + 18}
                            textAnchor="middle"
                            className={`font-mono text-[10px] ${
                              isHovered ? 'fill-slate-900 font-semibold' : 'fill-slate-500'
                            }`}
                          >
                            {pt.shortDateLabel}
                          </text>
                        </g>
                      );
                    })}

                    {/* Trend curve across daily totals */}
                    {hasAnyEggData && (
                      <path
                        d={eggSvg.totalLine}
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth={1.75}
                        strokeOpacity={0.75}
                        pointerEvents="none"
                      />
                    )}
                    {hasAnyEggData &&
                      points.map((pt) => {
                        const cx = (eggSvg.x(pt.date) ?? 0) + eggSvg.x.bandwidth() / 2;
                        const cy = eggSvg.y(pt.totalEggs);
                        const active = hoveredEggDate === pt.date;
                        return (
                          <circle
                            key={`dot-${pt.date}`}
                            cx={cx}
                            cy={cy}
                            r={active ? 4.5 : 3}
                            fill={active ? '#065f46' : '#ffffff'}
                            stroke="#0f172a"
                            strokeWidth={1.75}
                            pointerEvents="none"
                          />
                        );
                      })}
                  </g>
                </svg>

                {/* Hover Tooltip */}
                {hoveredEggPoint && (
                  <div className="pointer-events-none absolute top-2 right-2 z-10 w-52 rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow-sm backdrop-blur-xs tabular-nums">
                    <div className="font-semibold text-slate-900">
                      {hoveredEggPoint.displayDate}
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Total Eggs:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {hoveredEggPoint.totalEggs.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Crates Eq.:</span>
                        <span className="font-mono text-slate-700">
                          {formatCratesPieces(hoveredEggPoint.totalEggs)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-800">Intact:</span>
                        <span className="font-mono font-semibold text-emerald-800">
                          {hoveredEggPoint.intactEggs.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-amber-700">Cracked / Dmg:</span>
                        <span className="font-mono font-semibold text-amber-700">
                          {hoveredEggPoint.crackedOrDamagedEggs.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-slate-100 pt-1 text-[11px] text-slate-500">
                        <span>Pickups Logged:</span>
                        <span className="font-mono">{hoveredEggPoint.eggEntryCount}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* D3 Chart 2: Daily Feed Consumption */}
          {canReadFeed && (
            <section
              aria-label="Daily feed consumption 7-day chart"
              className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 min-w-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Daily Feed Consumption (Last 7 Days)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Standardized feed issued (kg) with locked historical cost breakdown
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs bg-amber-600 inline-block" />
                    Feed Issued (kg)
                  </span>
                </div>
              </div>

              <div ref={feedContainer.ref} className="relative mt-3 w-full min-w-0">
                <svg
                  width={feedSvg.w}
                  height={feedSvg.h}
                  viewBox={`0 0 ${feedSvg.w} ${feedSvg.h}`}
                  role="img"
                  aria-label="Area and column chart of daily feed consumption in kilograms over the last 7 days"
                  className="block w-full overflow-visible select-none"
                >
                  <g transform={`translate(${MARGIN_SINGLE.left},${MARGIN_SINGLE.top})`}>
                    {/* Horizontal gridlines & Y-axis labels */}
                    {feedSvg.yTicks.map((tick) => {
                      const ty = feedSvg.y(tick);
                      return (
                        <g key={tick} transform={`translate(0,${ty})`}>
                          <line
                            x1={0}
                            x2={feedSvg.innerW}
                            y1={0}
                            y2={0}
                            stroke="#e2e8f0"
                            strokeDasharray={tick === 0 ? undefined : '2 3'}
                          />
                          <text
                            x={-8}
                            y={3}
                            textAnchor="end"
                            className="fill-slate-500 font-mono text-[10px]"
                          >
                            {formatAxisKg(tick)} kg
                          </text>
                        </g>
                      );
                    })}

                    {/* D3 Area fill */}
                    {hasAnyFeedData && (
                      <path
                        d={feedSvg.feedArea}
                        fill="#fef3c7"
                        fillOpacity={0.75}
                        pointerEvents="none"
                      />
                    )}

                    {/* Subtle column bars + interactive hit columns */}
                    {points.map((pt) => {
                      const bx = feedSvg.x(pt.date) ?? 0;
                      const bw = feedSvg.x.bandwidth();
                      const yTop = feedSvg.y(pt.feedKg);
                      const barH = Math.max(0, feedSvg.innerH - yTop);
                      const isHovered = hoveredFeedDate === pt.date;

                      return (
                        <g
                          key={pt.date}
                          onMouseEnter={() => setHoveredFeedDate(pt.date)}
                          onMouseLeave={() => setHoveredFeedDate(null)}
                          onFocus={() => setHoveredFeedDate(pt.date)}
                          onBlur={() => setHoveredFeedDate(null)}
                          tabIndex={0}
                          className="cursor-pointer outline-none"
                        >
                          <rect
                            x={bx - 4}
                            y={0}
                            width={bw + 8}
                            height={feedSvg.innerH}
                            fill={isHovered ? '#f1f5f9' : 'transparent'}
                            rx={4}
                          />

                          {barH > 0 && (
                            <rect
                              x={bx}
                              y={yTop}
                              width={bw}
                              height={barH}
                              fill={isHovered ? '#b45309' : '#d97706'}
                              fillOpacity={isHovered ? 0.35 : 0.22}
                              rx={3}
                            />
                          )}

                          {pt.feedKg === 0 && (
                            <line
                              x1={bx + 2}
                              x2={bx + bw - 2}
                              y1={feedSvg.innerH - 1}
                              y2={feedSvg.innerH - 1}
                              stroke="#cbd5e1"
                              strokeWidth={2}
                            />
                          )}

                          <text
                            x={bx + bw / 2}
                            y={feedSvg.innerH + 18}
                            textAnchor="middle"
                            className={`font-mono text-[10px] ${
                              isHovered ? 'fill-slate-900 font-semibold' : 'fill-slate-500'
                            }`}
                          >
                            {pt.shortDateLabel}
                          </text>
                        </g>
                      );
                    })}

                    {/* D3 Trend Line */}
                    {hasAnyFeedData && (
                      <path
                        d={feedSvg.feedLine}
                        fill="none"
                        stroke="#b45309"
                        strokeWidth={2.25}
                        pointerEvents="none"
                      />
                    )}
                    {hasAnyFeedData &&
                      points.map((pt) => {
                        const cx = (feedSvg.x(pt.date) ?? 0) + feedSvg.x.bandwidth() / 2;
                        const cy = feedSvg.y(pt.feedKg);
                        const active = hoveredFeedDate === pt.date;
                        return (
                          <circle
                            key={`fdot-${pt.date}`}
                            cx={cx}
                            cy={cy}
                            r={active ? 5 : 3.5}
                            fill={active ? '#b45309' : '#ffffff'}
                            stroke="#b45309"
                            strokeWidth={2}
                            pointerEvents="none"
                          />
                        );
                      })}
                  </g>
                </svg>

                {/* Hover Tooltip */}
                {hoveredFeedPoint && (
                  <div className="pointer-events-none absolute top-2 right-2 z-10 w-52 rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow-sm backdrop-blur-xs tabular-nums">
                    <div className="font-semibold text-slate-900">
                      {hoveredFeedPoint.displayDate}
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Feed Issued:</span>
                        <span className="font-mono font-bold text-amber-800">
                          {hoveredFeedPoint.feedKg.toFixed(2)} kg
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Locked Cost:</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {formatNgn(hoveredFeedPoint.feedCostNgn)}
                        </span>
                      </div>
                      {canReadProd && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Feed / Egg:</span>
                          <span className="font-mono text-slate-700">
                            {hoveredFeedPoint.feedGramsPerEgg !== null
                              ? `${hoveredFeedPoint.feedGramsPerEgg.toFixed(1)} g`
                              : '—'}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-slate-100 pt-1 text-[11px] text-slate-500">
                        <span>Issues Logged:</span>
                        <span className="font-mono">{hoveredFeedPoint.feedEntryCount}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      ) : (
        /* D3 Combined Dual-Axis Overlay Chart */
        <section
          aria-label="Combined 7-day egg production and feed consumption overlay chart"
          className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 min-w-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Combined Egg Output vs. Feed Consumption (Last 7 Days)
              </h3>
              <p className="text-[11px] text-slate-500">
                Left axis: Daily eggs collected (bars) · Right axis: Daily feed issued in kg (curve)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 shrink-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-emerald-800 inline-block" />
                Total Eggs (Left Axis)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-amber-700 inline-block" />
                Feed kg (Right Axis)
              </span>
            </div>
          </div>

          <div ref={overlayContainer.ref} className="relative mt-3 w-full min-w-0">
            <svg
              width={overlaySvg.w}
              height={overlaySvg.h}
              viewBox={`0 0 ${overlaySvg.w} ${overlaySvg.h}`}
              role="img"
              aria-label="Dual axis D3 chart comparing daily egg production and feed consumption over the last 7 days"
              className="block w-full overflow-visible select-none"
            >
              <g transform={`translate(${MARGIN_OVERLAY.left},${MARGIN_OVERLAY.top})`}>
                {/* Left Axis Gridlines & Egg Tick Labels */}
                {overlaySvg.yEggTicks.map((tick) => {
                  const ty = overlaySvg.yEggs(tick);
                  return (
                    <g key={`left-${tick}`} transform={`translate(0,${ty})`}>
                      <line
                        x1={0}
                        x2={overlaySvg.innerW}
                        y1={0}
                        y2={0}
                        stroke="#e2e8f0"
                        strokeDasharray={tick === 0 ? undefined : '2 3'}
                      />
                      <text
                        x={-8}
                        y={3}
                        textAnchor="end"
                        className="fill-emerald-800 font-mono text-[10px]"
                      >
                        {formatAxisCount(tick)}
                      </text>
                    </g>
                  );
                })}

                {/* Right Axis Feed kg Tick Labels */}
                {overlaySvg.yFeedTicks.map((tick) => {
                  const ty = overlaySvg.yFeed(tick);
                  return (
                    <g key={`right-${tick}`} transform={`translate(${overlaySvg.innerW},${ty})`}>
                      <text
                        x={8}
                        y={3}
                        textAnchor="start"
                        className="fill-amber-800 font-mono text-[10px]"
                      >
                        {formatAxisKg(tick)} kg
                      </text>
                    </g>
                  );
                })}

                {/* Egg Bars + Hover Targets */}
                {points.map((pt) => {
                  const bx = overlaySvg.x(pt.date) ?? 0;
                  const bw = overlaySvg.x.bandwidth();
                  const yTotal = overlaySvg.yEggs(pt.totalEggs);
                  const barH = Math.max(0, overlaySvg.innerH - yTotal);
                  const isHovered = hoveredOverlayDate === pt.date;

                  return (
                    <g
                      key={pt.date}
                      onMouseEnter={() => setHoveredOverlayDate(pt.date)}
                      onMouseLeave={() => setHoveredOverlayDate(null)}
                      onFocus={() => setHoveredOverlayDate(pt.date)}
                      onBlur={() => setHoveredOverlayDate(null)}
                      tabIndex={0}
                      className="cursor-pointer outline-none"
                    >
                      <rect
                        x={bx - 4}
                        y={0}
                        width={bw + 8}
                        height={overlaySvg.innerH}
                        fill={isHovered ? '#f1f5f9' : 'transparent'}
                        rx={4}
                      />

                      {barH > 0 && (
                        <rect
                          x={bx}
                          y={yTotal}
                          width={bw}
                          height={barH}
                          fill={isHovered ? '#064e3b' : '#065f46'}
                          fillOpacity={isHovered ? 0.92 : 0.82}
                          rx={3}
                        />
                      )}

                      <text
                        x={bx + bw / 2}
                        y={overlaySvg.innerH + 18}
                        textAnchor="middle"
                        className={`font-mono text-[10px] ${
                          isHovered ? 'fill-slate-900 font-semibold' : 'fill-slate-500'
                        }`}
                      >
                        {pt.shortDateLabel}
                      </text>
                    </g>
                  );
                })}

                {/* Feed Line Overlay */}
                {hasAnyFeedData && (
                  <path
                    d={overlaySvg.feedLine}
                    fill="none"
                    stroke="#b45309"
                    strokeWidth={2.5}
                    pointerEvents="none"
                  />
                )}
                {hasAnyFeedData &&
                  points.map((pt) => {
                    const cx = (overlaySvg.x(pt.date) ?? 0) + overlaySvg.x.bandwidth() / 2;
                    const cy = overlaySvg.yFeed(pt.feedKg);
                    const active = hoveredOverlayDate === pt.date;
                    return (
                      <circle
                        key={`odot-${pt.date}`}
                        cx={cx}
                        cy={cy}
                        r={active ? 5.5 : 4}
                        fill={active ? '#b45309' : '#ffffff'}
                        stroke="#b45309"
                        strokeWidth={2}
                        pointerEvents="none"
                      />
                    );
                  })}
              </g>
            </svg>

            {hoveredOverlayPoint && (
              <div className="pointer-events-none absolute top-2 right-16 z-10 w-56 rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow-sm backdrop-blur-xs tabular-nums">
                <div className="font-semibold text-slate-900">
                  {hoveredOverlayPoint.displayDate}
                </div>
                <div className="mt-1.5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-emerald-800">Total Eggs:</span>
                    <span className="font-mono font-bold text-emerald-900">
                      {hoveredOverlayPoint.totalEggs.toLocaleString()} ({formatCratesPieces(hoveredOverlayPoint.totalEggs)})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-800">Feed Issued:</span>
                    <span className="font-mono font-bold text-amber-800">
                      {hoveredOverlayPoint.feedKg.toFixed(2)} kg
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Feed Cost:</span>
                    <span className="font-mono text-slate-900">
                      {formatNgn(hoveredOverlayPoint.feedCostNgn)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-1">
                    <span className="text-slate-500">Feed / Egg:</span>
                    <span className="font-mono text-slate-700">
                      {hoveredOverlayPoint.feedGramsPerEgg !== null
                        ? `${hoveredOverlayPoint.feedGramsPerEgg.toFixed(1)} g`
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Compact 7-Day Daily Breakdown Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            7-Day Daily Breakdown
          </h3>
          <span className="font-mono text-[11px] text-slate-500">{scopedBatchLabel}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-white text-slate-500">
                <th className="px-4 py-2.5 font-medium">Date</th>
                {canReadProd && <th className="px-4 py-2.5 text-right font-medium">Pickups</th>}
                {canReadProd && <th className="px-4 py-2.5 text-right font-medium">Intact</th>}
                {canReadProd && <th className="px-4 py-2.5 text-right font-medium">Cracked/Dmg</th>}
                {canReadProd && <th className="px-4 py-2.5 text-right font-medium">Total Eggs</th>}
                {canReadFeed && <th className="px-4 py-2.5 text-right font-medium">Feed Issues</th>}
                {canReadFeed && <th className="px-4 py-2.5 text-right font-medium">Feed (kg)</th>}
                {canReadFeed && <th className="px-4 py-2.5 text-right font-medium">Feed Cost</th>}
                {canReadProd && canReadFeed && (
                  <th className="px-4 py-2.5 text-right font-medium">g / Egg</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {points.map((pt) => (
                <tr key={pt.date} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono font-medium text-slate-900 whitespace-nowrap">
                    {pt.displayDate}
                  </td>
                  {canReadProd && (
                    <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                      {pt.eggEntryCount}
                    </td>
                  )}
                  {canReadProd && (
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-800">
                      {pt.intactEggs.toLocaleString()}
                    </td>
                  )}
                  {canReadProd && (
                    <td className="px-4 py-2.5 text-right font-mono text-amber-700">
                      {pt.crackedOrDamagedEggs.toLocaleString()}
                    </td>
                  )}
                  {canReadProd && (
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900">
                      {pt.totalEggs.toLocaleString()}{' '}
                      <span className="text-[11px] font-normal text-slate-500">
                        ({formatCratesPieces(pt.totalEggs)})
                      </span>
                    </td>
                  )}
                  {canReadFeed && (
                    <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                      {pt.feedEntryCount}
                    </td>
                  )}
                  {canReadFeed && (
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-amber-800">
                      {pt.feedKg.toFixed(2)} kg
                    </td>
                  )}
                  {canReadFeed && (
                    <td className="px-4 py-2.5 text-right font-mono text-slate-900">
                      {formatNgn(pt.feedCostNgn)}
                    </td>
                  )}
                  {canReadProd && canReadFeed && (
                    <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                      {pt.feedGramsPerEgg !== null ? `${pt.feedGramsPerEgg.toFixed(1)} g` : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900 tabular-nums">
                <td className="px-4 py-2.5">7-Day Total</td>
                {canReadProd && (
                  <td className="px-4 py-2.5 text-right font-mono">
                    {points.reduce((s, p) => s + p.eggEntryCount, 0)}
                  </td>
                )}
                {canReadProd && (
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-800">
                    {summary.totalIntact.toLocaleString()}
                  </td>
                )}
                {canReadProd && (
                  <td className="px-4 py-2.5 text-right font-mono text-amber-700">
                    {summary.totalCrackedDamaged.toLocaleString()}
                  </td>
                )}
                {canReadProd && (
                  <td className="px-4 py-2.5 text-right font-mono">
                    {summary.totalEggs.toLocaleString()}
                  </td>
                )}
                {canReadFeed && (
                  <td className="px-4 py-2.5 text-right font-mono">
                    {points.reduce((s, p) => s + p.feedEntryCount, 0)}
                  </td>
                )}
                {canReadFeed && (
                  <td className="px-4 py-2.5 text-right font-mono text-amber-800">
                    {summary.totalFeedKg.toFixed(2)} kg
                  </td>
                )}
                {canReadFeed && (
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatNgn(summary.totalFeedCostNgn)}
                  </td>
                )}
                {canReadProd && canReadFeed && (
                  <td className="px-4 py-2.5 text-right font-mono">
                    {summary.feedGramsPerEgg !== null ? `${summary.feedGramsPerEgg.toFixed(1)} g` : '—'}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
