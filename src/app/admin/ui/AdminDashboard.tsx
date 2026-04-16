'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { platformFetch } from '@/lib/platformFetchClient';
import { logout as performLogout } from '@/lib/logout';
import { MultiLineChart, MultiSeriesTrend } from './charts/LineAreaChart';
import { BoilerHeatingStateChart, BoilerTemperatureBandChart, HeatingStateSeries } from './charts/BoilerCharts';

type HistoryBucket = 'daily' | 'weekly' | 'monthly';
type Preset = '7' | '30' | '90' | 'all' | 'custom';

type SummaryPoint = { bucketStart: string; label: string; totalKwhDelta: number };
type SummaryCostPoint = { bucketStart: string; label: string; estimatedCost: number };
type SummaryEntity = { entityId: string; name?: string; totalKwhDelta: number; estimatedCost?: number; area?: string | null };
type SummaryArea = { area: string; totalKwhDelta: number; estimatedCost?: number; topEntities: SummaryEntity[] };
type BatteryRow = { entityId: string; name?: string; latestBatteryPercent: number; capturedAt: string };
type BatteryPoint = { bucketStart: string; label: string; avgPercent: number; count: number };
type SummaryAreaSeries = { area: string; points: SummaryPoint[] };
type BatteryEntitySeries = { entityId: string; name?: string; points: Array<{ bucketStart: string; label: string; avgPercent: number }> };
type EntityOption = { entityId: string; name: string; area: string; lastCapturedAt: string };
type BoilerHistoryPoint = { bucketStart: string; label: string; value: number };
type BoilerTemperaturePoint = {
  bucketStart: string;
  label: string;
  currentTemperature: number;
  targetTemperature: number | null;
};
type BoilerHeatingPoint = { bucketStart: string; label: string; state: number | null };
type BoilerEntitySeries = { entityId: string; name: string; area: string; points: BoilerHistoryPoint[] };
type BoilerTemperatureSeries = { entityId: string; name: string; area: string; points: BoilerTemperaturePoint[] };
type BoilerHeatingSeries = { entityId: string; name: string; area: string; points: BoilerHeatingPoint[] };

type SummaryResponse = {
  ok: boolean;
  bucket: HistoryBucket;
  range: { from: string; to: string };
  lastSnapshotAt: string | null;
  pricePerKwh: number | null;
  coverage: { entitiesWithReadings: number; entitiesMonitored: number };
  seriesTotalKwh: SummaryPoint[];
  seriesKwhByArea: SummaryAreaSeries[];
  seriesTotalCost: SummaryCostPoint[];
  seriesBatteryAvgPercent: BatteryPoint[];
  seriesBatteryByEntity: BatteryEntitySeries[];
  topEntities: SummaryEntity[];
  byArea: SummaryArea[];
  batteryLow: BatteryRow[];
};
type BoilerHistoryResponse = {
  ok: boolean;
  unit: string;
  points: BoilerHistoryPoint[];
  seriesByArea?: Array<{ area: string; points: BoilerHistoryPoint[] }>;
  seriesByEntity?: BoilerEntitySeries[];
  seriesTemperatureByEntity?: BoilerTemperatureSeries[];
  seriesHeatingStateByEntity?: BoilerHeatingSeries[];
  error?: string;
};

type Props = { username?: string };

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return 'Not available';
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const dateOnly = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const numberFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const costFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });
const chartPalette = ['#0ea5e9', '#34c759', '#ff9500', '#af52de', '#ff3b30', '#5ac8fa', '#5856d6', '#30d158', '#ff2d55', '#ffd60a'];

type SelectOption = { id: string; label: string; hint?: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfDayUtc = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const endOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

const parseDateOnlyUtc = (value: string, endOfDay = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map((v) => Number(v));
  const date = endOfDay ? endOfDayUtc(new Date(Date.UTC(y, m - 1, d))) : startOfDayUtc(new Date(Date.UTC(y, m - 1, d)));
  return Number.isNaN(date.getTime()) ? null : date;
};

const getIsoWeekInfoUtc = (date: Date) => {
  const temp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const weekStart = new Date(Date.UTC(temp.getUTCFullYear(), temp.getUTCMonth(), temp.getUTCDate()));
  const weekStartDay = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStartDay - 1));

  return { year: temp.getUTCFullYear(), week, weekStart };
};

const formatDateUtc = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getBucketInfoUtc = (bucket: HistoryBucket, capturedAt: Date) => {
  if (bucket === 'weekly') {
    const { year, week, weekStart } = getIsoWeekInfoUtc(capturedAt);
    return {
      key: `${year}-W${String(week).padStart(2, '0')}`,
      bucketStart: new Date(weekStart),
      label: `Week of ${formatDateUtc(new Date(weekStart))}`,
    };
  }

  if (bucket === 'monthly') {
    const start = new Date(Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), 1));
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      bucketStart: start,
      label: `${monthNames[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    };
  }

  const start = startOfDayUtc(capturedAt);
  return { key: formatDateUtc(start), bucketStart: start, label: formatDateUtc(start) };
};

const aggregateKwhPoints = (points: SummaryPoint[], bucket: HistoryBucket) => {
  const buckets = new Map<string, { bucketStart: Date; label: string; total: number }>();
  for (const point of points) {
    const date = new Date(point.bucketStart);
    if (Number.isNaN(date.getTime())) continue;
    const info = getBucketInfoUtc(bucket, date);
    const existing = buckets.get(info.key);
    if (!existing) {
      buckets.set(info.key, { bucketStart: info.bucketStart, label: info.label, total: point.totalKwhDelta || 0 });
    } else {
      existing.total += point.totalKwhDelta || 0;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((entry) => ({
      bucketStart: entry.bucketStart.toISOString(),
      label: entry.label,
      totalKwhDelta: entry.total,
    }));
};

const aggregateBatteryAvgPoints = (points: BatteryPoint[], bucket: HistoryBucket) => {
  const buckets = new Map<string, { bucketStart: Date; label: string; sum: number; count: number }>();
  for (const point of points) {
    const date = new Date(point.bucketStart);
    if (Number.isNaN(date.getTime())) continue;
    const info = getBucketInfoUtc(bucket, date);
    const existing = buckets.get(info.key);
    const weighted = (point.avgPercent || 0) * (point.count || 0);
    if (!existing) {
      buckets.set(info.key, { bucketStart: info.bucketStart, label: info.label, sum: weighted, count: point.count || 0 });
    } else {
      existing.sum += weighted;
      existing.count += point.count || 0;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((entry) => ({
      bucketStart: entry.bucketStart.toISOString(),
      label: entry.label,
      avgPercent: entry.count > 0 ? entry.sum / entry.count : 0,
      count: entry.count,
    }));
};

const aggregateBatteryEntityPoints = (points: Array<{ bucketStart: string; label: string; avgPercent: number }>, bucket: HistoryBucket) => {
  const buckets = new Map<string, { bucketStart: Date; label: string; sum: number; count: number }>();
  for (const point of points) {
    const date = new Date(point.bucketStart);
    if (Number.isNaN(date.getTime())) continue;
    const info = getBucketInfoUtc(bucket, date);
    const existing = buckets.get(info.key);
    if (!existing) {
      buckets.set(info.key, { bucketStart: info.bucketStart, label: info.label, sum: point.avgPercent || 0, count: 1 });
    } else {
      existing.sum += point.avgPercent || 0;
      existing.count += 1;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((entry) => ({
      bucketStart: entry.bucketStart.toISOString(),
      label: entry.label,
      avgPercent: entry.count > 0 ? entry.sum / entry.count : 0,
    }));
};

const stableColorById = (id: string) => {
  const hash = id.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0);
  return chartPalette[Math.abs(hash) % chartPalette.length];
};

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: SelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };
  return (
    <div className="min-w-[220px] rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {selected.map((s) => {
          const match = options.find((o) => o.id === s);
          const chipLabel = match?.label || s;
          const chipHint = match?.hint || s;
          return (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
          >
            <span className="font-semibold">{chipLabel}</span>
            <span className="text-white/70">({chipHint})</span>
            <span className="font-semibold">×</span>
          </button>
          );
        })}
        {selected.length === 0 && <span className="text-xs text-slate-500">{placeholder || 'All'}</span>}
      </div>
      <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-100 bg-white">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <label key={opt.id} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4" checked={isSelected} onChange={() => toggle(opt.id)} />
              <div className="truncate">
                <div className="font-medium text-slate-900">{opt.label}</div>
                {opt.hint && <div className="text-[11px] font-mono text-slate-500">{opt.hint}</div>}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminDashboard({ username }: Props) {
  void username; // Provided by page for consistency; not required in observe-only UI.
  const [summaryAllDaily, setSummaryAllDaily] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<HistoryBucket>('daily');
  const [preset, setPreset] = useState<Preset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [energyEntities, setEnergyEntities] = useState<EntityOption[]>([]);
  const [batteryEntities, setBatteryEntities] = useState<EntityOption[]>([]);
  const [boilerEntities, setBoilerEntities] = useState<EntityOption[]>([]);
  const [selectedEnergyEntities, setSelectedEnergyEntities] = useState<string[]>([]);
  const [selectedBatteryEntities, setSelectedBatteryEntities] = useState<string[]>([]);
  const [selectedBoilerEntities, setSelectedBoilerEntities] = useState<string[]>([]);
  const [boilerTemperatureSeriesAll, setBoilerTemperatureSeriesAll] = useState<BoilerTemperatureSeries[]>([]);
  const [boilerHeatingSeriesAll, setBoilerHeatingSeriesAll] = useState<BoilerHeatingSeries[]>([]);
  const [boilerLoading, setBoilerLoading] = useState(false);
  const [boilerError, setBoilerError] = useState<string | null>(null);
  const [selectorsError, setSelectorsError] = useState<string | null>(null);
  const energyScrollRef = useRef<HTMLDivElement | null>(null);
  const batteryScrollRef = useRef<HTMLDivElement | null>(null);
  const boilerScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (preset !== 'custom') return;
    if (from && to) return;
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    setFrom(dateOnly(weekAgo));
    setTo(dateOnly(today));
  }, [preset, from, to]);

  const energyEntityAreaMap = useMemo(() => new Map(energyEntities.map((e) => [e.entityId, e.area])), [energyEntities]);
  const batteryEntityAreaMap = useMemo(() => new Map(batteryEntities.map((e) => [e.entityId, e.area])), [batteryEntities]);
  const rangeState = useMemo(() => {
    if (preset === 'all') {
      return { window: null as { from: Date; to: Date } | null, error: null as string | null };
    }

    if (preset === 'custom') {
      if (!from || !to) {
        return { window: null, error: 'Choose both from/to dates for a custom range.' };
      }
      const fromDate = parseDateOnlyUtc(from, false);
      const toDate = parseDateOnlyUtc(to, true);
      if (!fromDate || !toDate) {
        return { window: null, error: 'Invalid from/to date. Use YYYY-MM-DD.' };
      }
      if (toDate.getTime() < fromDate.getTime()) {
        return { window: null, error: 'From must be on or before to.' };
      }
      return { window: { from: fromDate, to: toDate }, error: null };
    }

    const days = Number.parseInt(preset, 10);
    if (!Number.isFinite(days) || days <= 0) {
      return { window: null, error: null };
    }
    const toDate = endOfDayUtc(new Date());
    const fromDate = startOfDayUtc(new Date(toDate.getTime() - (days - 1) * MS_PER_DAY));
    return { window: { from: fromDate, to: toDate }, error: null };
  }, [preset, from, to]);
  const rangeError = rangeState.error;

  const summary = useMemo(() => {
    if (!summaryAllDaily) return null;
    const hasAreaFilter = selectedAreas.length > 0;
    const areaSet = new Set(selectedAreas);
    const energySet = new Set(selectedEnergyEntities);
    const batterySet = new Set(selectedBatteryEntities);
    const rangeWindow = rangeState.window;
    const rangeReady = preset !== 'custom' || (from && to);
    const inRange = (iso: string) => {
      if (!rangeWindow || !rangeReady) return true;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return false;
      return date >= rangeWindow.from && date <= rangeWindow.to;
    };

    const matchesArea = (area?: string | null) => !hasAreaFilter || (area ? areaSet.has(area) : false);
    const matchesEnergyEntity = (entityId: string, area?: string | null) => {
      if (selectedEnergyEntities.length > 0 && !energySet.has(entityId)) return false;
      if (!hasAreaFilter) return true;
      const resolvedArea = area ?? energyEntityAreaMap.get(entityId);
      return resolvedArea ? areaSet.has(resolvedArea) : false;
    };
    const matchesBatteryEntity = (entityId: string) => {
      if (selectedBatteryEntities.length > 0 && !batterySet.has(entityId)) return false;
      if (!hasAreaFilter) return true;
      const resolvedArea = batteryEntityAreaMap.get(entityId);
      return resolvedArea ? areaSet.has(resolvedArea) : false;
    };

    const energySeriesDaily = summaryAllDaily.seriesKwhByArea
      .filter((series) => matchesArea(series.area))
      .map((series) => ({
        ...series,
        points: series.points.filter((p) => inRange(p.bucketStart)),
      }))
      .filter((series) => series.points.length > 0);

    const energySeriesBucketed = energySeriesDaily.map((series) => ({
      area: series.area,
      points: aggregateKwhPoints(series.points, bucket),
    }));

    const totalSeriesBuckets = new Map<string, { bucketStart: Date; label: string; total: number }>();
    for (const series of energySeriesBucketed) {
      for (const point of series.points) {
        const date = new Date(point.bucketStart);
        if (Number.isNaN(date.getTime())) continue;
        const key = point.bucketStart;
        const existing = totalSeriesBuckets.get(key);
        if (!existing) {
          totalSeriesBuckets.set(key, { bucketStart: date, label: point.label, total: point.totalKwhDelta || 0 });
        } else {
          existing.total += point.totalKwhDelta || 0;
        }
      }
    }
    const seriesTotalKwh = Array.from(totalSeriesBuckets.values())
      .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
      .map((entry) => ({
        bucketStart: entry.bucketStart.toISOString(),
        label: entry.label,
        totalKwhDelta: entry.total,
      }));

    const seriesTotalCost =
      summaryAllDaily.pricePerKwh == null
        ? []
        : seriesTotalKwh.map((entry) => ({
            bucketStart: entry.bucketStart,
            label: entry.label,
            estimatedCost: entry.totalKwhDelta * summaryAllDaily.pricePerKwh!,
          }));

    const batterySeriesDaily = summaryAllDaily.seriesBatteryByEntity
      .filter((series) => matchesBatteryEntity(series.entityId))
      .map((series) => ({
        ...series,
        points: series.points.filter((p) => inRange(p.bucketStart)),
      }))
      .filter((series) => series.points.length > 0);

    const seriesBatteryByEntity = batterySeriesDaily.map((series) => ({
      entityId: series.entityId,
      name: series.name,
      points: aggregateBatteryEntityPoints(series.points, bucket),
    }));

    const seriesBatteryAvgPercent = aggregateBatteryAvgPoints(
      summaryAllDaily.seriesBatteryAvgPercent.filter((p) => inRange(p.bucketStart)),
      bucket
    );

    const batteryLow: BatteryRow[] = [];
    for (const series of batterySeriesDaily) {
      const latest = series.points[series.points.length - 1];
      if (!latest) continue;
      if (latest.avgPercent < 25) {
        batteryLow.push({
          entityId: series.entityId,
          name: series.name,
          latestBatteryPercent: latest.avgPercent,
          capturedAt: latest.bucketStart,
        });
      }
    }

    const areaTotals = new Map<string, number>();
    for (const series of energySeriesDaily) {
      const total = series.points.reduce((sum, p) => sum + (p.totalKwhDelta || 0), 0);
      areaTotals.set(series.area, total);
    }

    const byArea = summaryAllDaily.byArea
      .filter((row) => matchesArea(row.area))
      .map((row) => {
        const total = areaTotals.get(row.area) ?? 0;
        return {
          ...row,
          totalKwhDelta: total,
          estimatedCost: summaryAllDaily.pricePerKwh == null ? undefined : total * summaryAllDaily.pricePerKwh,
          topEntities: row.topEntities.filter((entity) => matchesEnergyEntity(entity.entityId, row.area)),
        };
      })
      .sort((a, b) => b.totalKwhDelta - a.totalKwhDelta);

    const topEntities = summaryAllDaily.topEntities.filter((row) => matchesEnergyEntity(row.entityId, row.area));

    const rangeFrom = rangeWindow && rangeReady ? rangeWindow.from.toISOString() : summaryAllDaily.range.from;
    const rangeTo = rangeWindow && rangeReady ? rangeWindow.to.toISOString() : summaryAllDaily.range.to;

    return {
      ...summaryAllDaily,
      bucket,
      range: { from: rangeFrom, to: rangeTo },
      seriesTotalKwh,
      seriesTotalCost,
      seriesKwhByArea: energySeriesBucketed,
      seriesBatteryAvgPercent,
      seriesBatteryByEntity,
      topEntities,
      byArea,
      batteryLow,
    };
  }, [
    summaryAllDaily,
    selectedAreas,
    selectedEnergyEntities,
    selectedBatteryEntities,
    energyEntityAreaMap,
    batteryEntityAreaMap,
    bucket,
    preset,
    from,
    to,
    rangeState.window,
  ]);

  const totalKwh = useMemo(() => {
    if (!summary) return 0;
    return summary.seriesKwhByArea
      .filter((series) => (series.area || '').toLowerCase() !== 'unassigned')
      .reduce((sum, series) => sum + series.points.reduce((areaSum, point) => areaSum + (point.totalKwhDelta || 0), 0), 0);
  }, [summary]);
  const totalCost = useMemo(() => {
    if (!summary || summary.pricePerKwh == null) return null;
    return totalKwh * summary.pricePerKwh;
  }, [summary, totalKwh]);

  const energySeriesByArea: MultiSeriesTrend[] = useMemo(
    () =>
      (summary?.seriesKwhByArea ?? []).map((series) => ({
        id: series.area,
        label: series.area,
        points: series.points.map((p) => ({
          date: new Date(p.bucketStart),
          label: p.label,
          value: p.totalKwhDelta ?? 0,
        })),
      })),
    [summary]
  );

  const batterySeriesByEntity: MultiSeriesTrend[] = useMemo(
    () =>
      (summary?.seriesBatteryByEntity ?? []).map((series) => ({
        id: series.entityId,
        label: series.name || series.entityId,
        hint: series.entityId,
        points: series.points.map((p) => ({
          date: new Date(p.bucketStart),
          label: p.label,
          value: p.avgPercent ?? 0,
        })),
      })),
    [summary]
  );

  const boilerTemperatureSeriesFiltered = useMemo(() => {
    const hasAreaFilter = selectedAreas.length > 0;
    const areaSet = new Set(selectedAreas);
    const boilerEntitySet = new Set(selectedBoilerEntities);
    const hasBoilerEntityFilter = boilerEntitySet.size > 0;
    const rangeWindow = rangeState.window;
    const rangeReady = preset !== 'custom' || (from && to);
    const inRange = (iso: string) => {
      if (!rangeWindow || !rangeReady) return true;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return false;
      return date >= rangeWindow.from && date <= rangeWindow.to;
    };

    return boilerTemperatureSeriesAll
      .filter((series) => {
        if (hasAreaFilter && !areaSet.has(series.area)) return false;
        if (hasBoilerEntityFilter && !boilerEntitySet.has(series.entityId)) return false;
        return true;
      })
      .map((series) => ({
        ...series,
        points: series.points.filter((p) => inRange(p.bucketStart)),
      }))
      .filter((series) => series.points.length > 0);
  }, [
    boilerTemperatureSeriesAll,
    selectedAreas,
    selectedBoilerEntities,
    preset,
    from,
    to,
    rangeState.window,
  ]);

  const boilerHeatingSeriesFiltered = useMemo(() => {
    const hasAreaFilter = selectedAreas.length > 0;
    const areaSet = new Set(selectedAreas);
    const boilerEntitySet = new Set(selectedBoilerEntities);
    const hasBoilerEntityFilter = boilerEntitySet.size > 0;
    const rangeWindow = rangeState.window;
    const rangeReady = preset !== 'custom' || (from && to);
    const inRange = (iso: string) => {
      if (!rangeWindow || !rangeReady) return true;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return false;
      return date >= rangeWindow.from && date <= rangeWindow.to;
    };

    return boilerHeatingSeriesAll
      .filter((series) => {
        if (hasAreaFilter && !areaSet.has(series.area)) return false;
        if (hasBoilerEntityFilter && !boilerEntitySet.has(series.entityId)) return false;
        return true;
      })
      .map((series) => ({
        ...series,
        points: series.points.filter((p) => inRange(p.bucketStart)),
      }))
      .filter((series) => series.points.length > 0);
  }, [boilerHeatingSeriesAll, selectedAreas, selectedBoilerEntities, preset, from, to, rangeState.window]);

  const boilerAggregateTemperaturePoints = useMemo(() => {
    const buckets = new Map<
      string,
      {
        date: Date;
        label: string;
        currentSum: number;
        currentCount: number;
        targetSum: number;
        targetCount: number;
      }
    >();

    for (const series of boilerTemperatureSeriesFiltered) {
      for (const point of series.points) {
        const date = new Date(point.bucketStart);
        if (Number.isNaN(date.getTime())) continue;
        const key = point.bucketStart;
        const existing = buckets.get(key);
        if (!existing) {
          buckets.set(key, {
            date,
            label: point.label,
            currentSum: point.currentTemperature,
            currentCount: 1,
            targetSum: point.targetTemperature ?? 0,
            targetCount: point.targetTemperature == null ? 0 : 1,
          });
        } else {
          existing.currentSum += point.currentTemperature;
          existing.currentCount += 1;
          if (point.targetTemperature != null) {
            existing.targetSum += point.targetTemperature;
            existing.targetCount += 1;
          }
        }
      }
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((bucket) => ({
        date: bucket.date,
        label: bucket.label,
        currentTemperature: bucket.currentCount > 0 ? bucket.currentSum / bucket.currentCount : 0,
        targetTemperature: bucket.targetCount > 0 ? bucket.targetSum / bucket.targetCount : null,
      }));
  }, [boilerTemperatureSeriesFiltered]);

  const boilerHeatingSeriesByEntity: HeatingStateSeries[] = useMemo(
    () =>
      boilerHeatingSeriesFiltered.map((series) => ({
        id: series.entityId,
        label: series.name || series.entityId,
        hint: `${series.entityId} • ${series.area}`,
        color: stableColorById(series.entityId),
        points: series.points.map((p) => ({
          date: new Date(p.bucketStart),
          label: p.label,
          state: p.state,
        })),
      })),
    [boilerHeatingSeriesFiltered]
  );

  const boilerTemperaturePointCount = useMemo(
    () => boilerAggregateTemperaturePoints.length,
    [boilerAggregateTemperaturePoints]
  );
  const boilerStatePointCount = useMemo(
    () => Math.max(0, ...boilerHeatingSeriesByEntity.map((s) => s.points.length)),
    [boilerHeatingSeriesByEntity]
  );
  const boilerMissingTargetSamples = useMemo(() => {
    let total = 0;
    let withTarget = 0;
    for (const series of boilerTemperatureSeriesFiltered) {
      for (const point of series.points) {
        total += 1;
        if (point.targetTemperature != null) withTarget += 1;
      }
    }
    return Math.max(0, total - withTarget);
  }, [boilerTemperatureSeriesFiltered]);
  const boilerLegacySeriesByEntity: MultiSeriesTrend[] = useMemo(
    () =>
      boilerTemperatureSeriesFiltered.map((series) => ({
        id: series.entityId,
        label: series.name || series.entityId,
        hint: `${series.entityId} • ${series.area}`,
        color: stableColorById(series.entityId),
        points: series.points.map((p) => ({
          date: new Date(p.bucketStart),
          label: p.label,
          value: p.currentTemperature,
        })),
      })),
    [boilerTemperatureSeriesFiltered]
  );

  const energyPointCount = useMemo(
    () => Math.max(0, ...energySeriesByArea.map((s) => s.points.length)),
    [energySeriesByArea]
  );
  const batteryPointCount = useMemo(
    () => Math.max(0, ...batterySeriesByEntity.map((s) => s.points.length)),
    [batterySeriesByEntity]
  );
  useEffect(() => {
    const el = energyScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, [energySeriesByArea, bucket]);

  useEffect(() => {
    const el = batteryScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, [batterySeriesByEntity, bucket]);

  useEffect(() => {
    const el = boilerScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, [boilerHeatingSeriesByEntity]);

  // Coverage removed from UI; metric no longer used

  const batteryLowCount = summary?.batteryLow.length ?? 0;

  const buildSummaryParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('bucket', 'daily');
    params.set('days', 'all');
    return params.toString();
  }, []);

  const buildSelectorParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('days', 'all');
    return params.toString();
  }, []);

  const buildBoilerParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('days', 'all');
    params.set('groupBy', 'area');
    return params.toString();
  }, []);

  const loadSummary = async (paramsOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = paramsOverride ?? buildSummaryParams();
      const res = await platformFetch(`/api/admin/monitoring/summary?${params}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => null)) as (SummaryResponse & { error?: string }) | null;
      if (!res.ok || !data?.ok) {
        const message =
          data && typeof data.error === 'string' && data.error.length > 0 ? data.error : 'Unable to load analytics right now.';
        throw new Error(message);
      }
      setSummaryAllDaily(data);
      setLastFetchedAt(new Date().toISOString());
    } catch (err) {
      console.error('Failed to load summary', err);
      setError((err as Error).message || 'Unable to load analytics right now.');
      setSummaryAllDaily(null);
    } finally {
      setLoading(false);
    }
  };

  const loadSelectors = useCallback(async () => {
    try {
      setSelectorsError(null);
      const [areasRes, entitiesRes, boilerRes] = await Promise.all([
        platformFetch('/api/admin/areas', { cache: 'no-store', credentials: 'include' }),
        platformFetch(`/api/admin/monitoring/entities?${buildSelectorParams()}`, { cache: 'no-store', credentials: 'include' }),
        platformFetch(`/api/admin/monitoring/boiler-entities?${buildSelectorParams()}`, {
          cache: 'no-store',
          credentials: 'include',
        }),
      ]);
      const areasData = await areasRes.json().catch(() => ({}));
      const entitiesData = await entitiesRes.json().catch(() => ({}));
      const boilerData = await boilerRes.json().catch(() => ({}));
      if (!areasRes.ok) throw new Error(areasData.error || 'Unable to load areas.');
      if (!entitiesRes.ok) throw new Error(entitiesData.error || 'Unable to load entities.');
      if (!boilerRes.ok) throw new Error(boilerData.error || 'Unable to load boiler devices.');
      const areaList: string[] = Array.isArray(areasData.areas)
        ? Array.from(
            new Set(
              areasData.areas
                .filter((a: unknown): a is string => typeof a === 'string')
                .map((a: string) => a.trim())
                .filter((a: string) => a.length > 0 && a.toLowerCase() !== 'unassigned')
            )
          )
        : [];
      setAreas(areaList.sort((a, b) => a.localeCompare(b)) as string[]);
      const energyList = Array.isArray(entitiesData.energyEntities) ? entitiesData.energyEntities : [];
      const batteryList = Array.isArray(entitiesData.batteryEntities) ? entitiesData.batteryEntities : [];
      setEnergyEntities(energyList.filter((e: EntityOption) => (e.area || '').toLowerCase() !== 'unassigned'));
      setBatteryEntities(batteryList.filter((e: EntityOption) => (e.area || '').toLowerCase() !== 'unassigned'));
      const boilerList = Array.isArray(boilerData.boilerEntities) ? boilerData.boilerEntities : [];
      setBoilerEntities(boilerList.filter((e: EntityOption) => (e.area || '').toLowerCase() !== 'unassigned'));

      const energyIds = new Set(energyList.map((e: EntityOption) => e.entityId));
      const batteryIds = new Set(batteryList.map((e: EntityOption) => e.entityId));
      const boilerIds = new Set(boilerList.map((e: EntityOption) => e.entityId));
      setSelectedEnergyEntities((prev) => prev.filter((id) => energyIds.has(id)));
      setSelectedBatteryEntities((prev) => prev.filter((id) => batteryIds.has(id)));
      setSelectedBoilerEntities((prev) => prev.filter((id) => boilerIds.has(id)));
    } catch (err) {
      console.error('Failed to load selectors', err);
      setSelectorsError((err as Error).message || 'Unable to load filters.');
    }
  }, [buildSelectorParams]);

  const loadBoilerHistory = useCallback(async (paramsOverride?: string) => {
    setBoilerLoading(true);
    setBoilerError(null);
    try {
      const params = paramsOverride ?? buildBoilerParams();
      const res = await platformFetch(`/api/admin/monitoring/boiler-history?${params}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => null)) as BoilerHistoryResponse | null;
      if (!res.ok || !data?.ok) {
        const message =
          data && typeof data.error === 'string' && data.error.length > 0 ? data.error : 'Unable to load boiler trend.';
        throw new Error(message);
      }
      const temperatureSeries: BoilerTemperatureSeries[] = Array.isArray(data.seriesTemperatureByEntity)
        ? data.seriesTemperatureByEntity
        : Array.isArray(data.seriesByEntity)
        ? data.seriesByEntity.map((series) => ({
            entityId: series.entityId,
            name: series.name,
            area: series.area,
            points: series.points.map((point) => ({
              bucketStart: point.bucketStart,
              label: point.label,
              currentTemperature: point.value,
              targetTemperature: null,
            })),
          }))
        : [];
      const heatingSeries: BoilerHeatingSeries[] = Array.isArray(data.seriesHeatingStateByEntity)
        ? data.seriesHeatingStateByEntity
        : temperatureSeries.map((series) => ({
            entityId: series.entityId,
            name: series.name,
            area: series.area,
            points: series.points.map((point) => ({
              bucketStart: point.bucketStart,
              label: point.label,
              state:
                point.targetTemperature == null
                  ? null
                  : point.targetTemperature > point.currentTemperature
                  ? 1
                  : 0,
            })),
          }));
      setBoilerTemperatureSeriesAll(temperatureSeries);
      setBoilerHeatingSeriesAll(heatingSeries);
    } catch (err) {
      console.error('Failed to load boiler trend', err);
      setBoilerError((err as Error).message || 'Unable to load boiler trend.');
      setBoilerTemperatureSeriesAll([]);
      setBoilerHeatingSeriesAll([]);
    } finally {
      setBoilerLoading(false);
    }
  }, [buildBoilerParams]);

  useEffect(() => {
    void loadSummary();
    void loadSelectors();
    void loadBoilerHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastSnapshotDisplay = summaryAllDaily ? formatDateTime(summaryAllDaily.lastSnapshotAt) : 'Not available';
  const lastFetchedDisplay = lastFetchedAt ? formatDateTime(lastFetchedAt) : 'Never';
  const handleRefresh = () => {
    void loadSummary();
    void loadBoilerHistory();
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-3 pb-16 pt-8 sm:px-4 lg:pt-12">
        <header className="sticky top-4 z-30 flex flex-col gap-3 rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:rounded-full sm:px-6 sm:py-2.5">
          <div className="flex items-start gap-3 sm:items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/60 bg-white shadow-sm">
              <Image src="/brand/logo-mark.png" alt="Dinodia" width={40} height={40} priority />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">Admin analytics</p>
              <p className="text-base font-semibold text-slate-900">Homeowner Energy Monitoring Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs leading-tight text-slate-500">
              <p className="font-semibold text-slate-700">Last snapshot</p>
              <p>{lastSnapshotDisplay}</p>
            </div>
            <div className="relative">
              <button
                type="button"
                aria-label="Menu"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 shadow-sm hover:bg-white"
              >
                <span className="sr-only">Menu</span>
                <span className="flex flex-col gap-1">
                  <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
                  <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
                  <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
                </span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-100 bg-white/95 p-1 text-sm text-slate-700 shadow-lg backdrop-blur">
                  <Link
                    href="/admin/dashboard"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    Homeowner Dashboard
                  </Link>
                  <Link
                    href="/admin/settings"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    Account Settings
                  </Link>
                  <Link
                    href="/admin/manage-devices"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    Home Devices
                  </Link>
                  <Link
                    href="/admin/manage-users"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    User Management
                  </Link>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      void performLogout();
                    }}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Range</span>
              {(['7', '30', '90', 'all'] as Preset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                    preset === p ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {p === 'all' ? 'All time' : `${p}d`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreset('custom')}
                className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                  preset === 'custom' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Custom
              </button>
            </div>
            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">From</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">To</span>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                  />
                </label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Bucket</span>
              <select
                value={bucket}
                onChange={(e) => setBucket(e.target.value as HistoryBucket)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
              >
                {loading && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-white" />}
                Refresh
              </button>
              <p className="text-xs text-slate-500">Last refresh: {lastFetchedDisplay}</p>
            </div>
          </div>
          {error && (
            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
          {rangeError && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {rangeError}
            </div>
          )}
          {selectorsError && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {selectorsError}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
          <MultiSelect
            label="Areas"
            options={areas.map((a) => ({ id: a, label: a, hint: a }))}
            selected={selectedAreas}
            onChange={setSelectedAreas}
            placeholder="All areas"
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Total energy</p>
            <p className="text-2xl font-semibold text-slate-900">{numberFmt.format(totalKwh)} kWh</p>
            <p className="text-xs text-slate-500">{summary ? `${formatDateTime(summary.range.from)} → ${formatDateTime(summary.range.to)}` : ''}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Estimated cost</p>
            <p className="text-2xl font-semibold text-slate-900">{totalCost != null ? costFmt.format(totalCost) : 'Price not set'}</p>
            <p className="text-xs text-slate-500">
              {summary?.pricePerKwh != null ? `Price £${summary.pricePerKwh}/kWh` : 'Set ELECTRICITY_PRICE_PER_KWH'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Low battery</p>
            <p className="text-2xl font-semibold text-slate-900">{batteryLowCount}</p>
            <p className="text-xs text-slate-500">Below 25%</p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Energy trend</h2>
            <span className="text-xs text-slate-500">
              Bucket: {bucket}, points: {energyPointCount}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
            <MultiSelect
              label="Energy entities"
              options={energyEntities.map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
              selected={selectedEnergyEntities}
              onChange={setSelectedEnergyEntities}
              placeholder="All energy entities"
            />
          </div>
          <div
            ref={energyScrollRef}
            className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm"
          >
            <div
              className="min-w-[900px]"
              style={{ minWidth: `${Math.max(900, energyPointCount * 32)}px` }}
            >
              <MultiLineChart
                id="energy-trend"
                title="Energy by area"
                series={energySeriesByArea}
                valueUnit="kWh"
                emptyLabel="No energy readings in this window."
                formatValue={(v) => Number(v).toFixed(2)}
                forcedWidth={Math.max(900, energyPointCount * 32)}
              />
            </div>
          </div>
          {summary?.seriesTotalCost?.length ? (
            <div className="mt-2 text-sm text-slate-600">Cost trend mirrors energy using configured £/kWh.</div>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Battery trend</h2>
            <span className="text-xs text-slate-500">
              Bucket: {bucket}, points: {batteryPointCount}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
            <MultiSelect
              label="Battery entities"
              options={batteryEntities.map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
              selected={selectedBatteryEntities}
              onChange={setSelectedBatteryEntities}
              placeholder="All battery entities"
            />
          </div>
          <div
            ref={batteryScrollRef}
            className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm"
          >
            <div
              className="min-w-[900px]"
              style={{ minWidth: `${Math.max(900, batteryPointCount * 32)}px` }}
            >
              <MultiLineChart
                id="battery-trend"
                title="Battery by entity"
                series={batterySeriesByEntity}
                valueUnit="%"
                emptyLabel="No battery readings in this window."
                formatValue={(v) => v.toFixed(0)}
                forcedWidth={Math.max(900, batteryPointCount * 32)}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">Average of latest battery % per entity per bucket.</p>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Boiler temperature trend</h2>
            <span className="text-xs text-slate-500">
              Temp points: {boilerTemperaturePointCount} · State points: {boilerStatePointCount}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
            <MultiSelect
              label="Boiler entities"
              options={boilerEntities.map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
              selected={selectedBoilerEntities}
              onChange={setSelectedBoilerEntities}
              placeholder="All boiler entities"
            />
          </div>
          {boilerMissingTargetSamples > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No target temperature snapshots in part of this range. Missing samples: {boilerMissingTargetSamples}.
            </div>
          ) : null}
          <div
            className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm"
          >
            <div
              className="min-w-[900px]"
              style={{ minWidth: `${Math.max(900, boilerTemperaturePointCount * 44)}px` }}
            >
              {boilerError ? (
                <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                  {boilerError}
                </div>
              ) : boilerLoading ? (
                <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                  Loading boiler trend…
                </div>
              ) : boilerAggregateTemperaturePoints.length === 0 ? (
                <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                  No boiler readings in this window.
                </div>
              ) : (
                <BoilerTemperatureBandChart
                  id="boiler-temperature-band"
                  title="Current vs target temperature"
                  points={boilerAggregateTemperaturePoints}
                  emptyLabel="No boiler readings in this window."
                  forcedWidth={Math.max(900, boilerTemperaturePointCount * 44)}
                />
              )}
            </div>
          </div>
          <div
            ref={boilerScrollRef}
            className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm"
          >
            <div
              className="min-w-[900px]"
              style={{ minWidth: `${Math.max(900, boilerStatePointCount * 40)}px` }}
            >
              {boilerError ? (
                <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                  {boilerError}
                </div>
              ) : boilerLoading ? (
                <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                  Loading heating state trend…
                </div>
              ) : boilerHeatingSeriesByEntity.length === 0 ? (
                <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                  No heating state samples in this window.
                </div>
              ) : (
                <BoilerHeatingStateChart
                  id="boiler-heating-state"
                  title="Boiler heating ON/OFF by entity"
                  series={boilerHeatingSeriesByEntity}
                  emptyLabel="No heating state samples in this window."
                  forcedWidth={Math.max(900, boilerStatePointCount * 40)}
                />
              )}
            </div>
          </div>
          {boilerMissingTargetSamples > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="min-w-[900px]" style={{ minWidth: `${Math.max(900, boilerTemperaturePointCount * 32)}px` }}>
                <MultiLineChart
                  id="boiler-current-fallback"
                  title="Current temperature only (for legacy rows without target)"
                  series={boilerLegacySeriesByEntity}
                  valueUnit="°C"
                  emptyLabel="No boiler readings in this window."
                  formatValue={(v) => v.toFixed(1)}
                  forcedWidth={Math.max(900, boilerTemperaturePointCount * 32)}
                  xTickIntervalHours={2}
                />
              </div>
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            2-hour snapshots. Heating ON when target is above current; OFF when target is below or equal to current.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Top entities (overall)</h3>
              <span className="text-xs text-slate-500">Top 20 by kWh</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <table className="w-full text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Entity</th>
                    <th className="px-3 py-2 text-left">Area</th>
                    <th className="px-3 py-2 text-right">kWh</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.topEntities ?? [])
                    .filter((row) => (row.area || '').toLowerCase() !== 'unassigned')
                    .map((row) => (
                    <tr key={row.entityId} className="odd:bg-white even:bg-slate-50/60">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{row.name || row.entityId}</div>
                        <div className="font-mono text-[11px] text-slate-500">{row.entityId}</div>
                      </td>
                      <td className="px-3 py-2">{row.area ?? 'Unassigned'}</td>
                      <td className="px-3 py-2 text-right">{row.totalKwhDelta.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{row.estimatedCost != null ? costFmt.format(row.estimatedCost) : '—'}</td>
                    </tr>
                  ))}
                  {(summary?.topEntities?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                        No energy readings in this window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">By area</h3>
              <span className="text-xs text-slate-500">Top 30 areas, 10 entities each</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <table className="w-full text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Area</th>
                    <th className="px-3 py-2 text-right">kWh</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-left">Top entities</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.byArea ?? [])
                    .filter((row) => (row.area || '').toLowerCase() !== 'unassigned')
                    .map((row) => (
                    <tr key={row.area} className="odd:bg-white even:bg-slate-50/60">
                      <td className="px-3 py-2">{row.area}</td>
                      <td className="px-3 py-2 text-right">{row.totalKwhDelta.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{row.estimatedCost != null ? costFmt.format(row.estimatedCost) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {row.topEntities.length === 0
                          ? '—'
                          : row.topEntities
                              .slice(0, 3)
                              .map((e) => `${e.entityId} (${e.totalKwhDelta.toFixed(1)} kWh)`)
                              .join(', ')}
                      </td>
                    </tr>
                  ))}
                  {(summary?.byArea?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                        No area data yet (assign areas to reduce Unassigned).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Battery health</h3>
            <span className="text-xs text-slate-500">Latest values per entity</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="w-full text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Entity</th>
                  <th className="px-3 py-2 text-left">Percent</th>
                  <th className="px-3 py-2 text-left">Captured at (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.batteryLow ?? []).map((row) => (
                  <tr key={row.entityId} className="odd:bg-white even:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-xs">{row.entityId}</td>
                    <td className="px-3 py-2 text-red-600 font-semibold">{row.latestBatteryPercent}%</td>
                    <td className="px-3 py-2 text-slate-600">{new Date(row.capturedAt).toLocaleString('en-GB', { timeZone: 'UTC' })}</td>
                  </tr>
                ))}
                {(summary?.batteryLow?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                      No batteries below 25% in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Battery entities are detected by unit % and an entity id containing “battery”. Threshold fixed at 25%.</p>
        </section>
      </div>
    </div>
  );
}
