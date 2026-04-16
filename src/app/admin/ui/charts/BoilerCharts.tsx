'use client';

import type { PointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { bisector, extent } from 'd3-array';
import { scaleLinear, scaleTime } from 'd3-scale';
import { curveMonotoneX, curveStepAfter, line } from 'd3-shape';
import { timeHour } from 'd3-time';

const chartPadding = { top: 24, right: 24, bottom: 34, left: 56 };
const palette = ['#0ea5e9', '#34c759', '#ff9500', '#af52de', '#ff3b30', '#5ac8fa', '#5856d6', '#30d158'];
const ORANGE_BAND = '#f97316';
const BLUE_BAND = '#0ea5e9';
const NEUTRAL_BAND = '#94a3b8';

type TemperaturePoint = {
  date: Date;
  label: string;
  currentTemperature: number;
  targetTemperature: number | null;
};

type HeatingStatePoint = {
  date: Date;
  label: string;
  state: number | null;
};

export type HeatingStateSeries = {
  id: string;
  label: string;
  hint?: string;
  color?: string;
  points: HeatingStatePoint[];
};

const ChartEmpty = ({ label }: { label?: string }) => (
  <div className="flex h-[280px] items-center justify-center rounded-2xl border border-slate-200/70 bg-white/80 text-sm text-slate-500">
    {label || 'No readings in this range.'}
  </div>
);

const formatTemp = (value: number) => `${value.toFixed(1)} °C`;
const formatDateTime = (date: Date) =>
  date.toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

function findNearestDate(points: Array<{ date: Date }>, target: Date) {
  if (points.length === 0) return null;
  const b = bisector((d: { date: Date }) => d.date).center;
  const idx = b(points, target);
  return points[Math.max(0, Math.min(points.length - 1, idx))] ?? null;
}

function bandColor(deltaA: number, deltaB: number) {
  const avg = (deltaA + deltaB) / 2;
  if (avg > 0) return ORANGE_BAND;
  if (avg < 0) return BLUE_BAND;
  return NEUTRAL_BAND;
}

export function BoilerTemperatureBandChart({
  id,
  title,
  points,
  height = 340,
  forcedWidth,
  emptyLabel,
}: {
  id: string;
  title: string;
  points: TemperaturePoint[];
  height?: number;
  forcedWidth?: number;
  emptyLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!containerRef.current || forcedWidth) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [forcedWidth]);

  const prepared = useMemo(
    () =>
      points
        .filter((p) => Number.isFinite(p.currentTemperature) && !Number.isNaN(p.currentTemperature))
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [points]
  );

  const xDomain = extent(prepared, (d) => d.date);
  const yValues = prepared.flatMap((point) =>
    point.targetTemperature == null ? [point.currentTemperature] : [point.currentTemperature, point.targetTemperature]
  );
  const yMinRaw = yValues.length > 0 ? Math.min(...yValues) : 0;
  const yMaxRaw = yValues.length > 0 ? Math.max(...yValues) : 1;
  const yPadding = Math.max(0.8, (yMaxRaw - yMinRaw) * 0.12);
  const yDomain: [number, number] = [yMinRaw - yPadding, yMaxRaw + yPadding];

  const measuredWidth = forcedWidth || width || 640;
  const innerWidth = Math.max(140, measuredWidth - chartPadding.left - chartPadding.right);
  const innerHeight = Math.max(160, height - chartPadding.top - chartPadding.bottom);

  const xScale = scaleTime().domain((xDomain as [Date, Date]) || [new Date(), new Date()]).range([0, innerWidth]);
  const yScale = scaleLinear().domain(yDomain).range([innerHeight, 0]);

  const currentPath =
    prepared.length > 0
      ? line<TemperaturePoint>()
          .x((d) => xScale(d.date))
          .y((d) => yScale(d.currentTemperature))
          .curve(curveMonotoneX)(prepared)
      : null;

  const targetPath =
    prepared.length > 0
      ? line<TemperaturePoint>()
          .defined((d) => d.targetTemperature != null && Number.isFinite(d.targetTemperature))
          .x((d) => xScale(d.date))
          .y((d) => yScale(d.targetTemperature ?? d.currentTemperature))
          .curve(curveMonotoneX)(prepared)
      : null;

  const areaBands = useMemo(() => {
    const bands: Array<{ id: string; points: string; color: string }> = [];

    for (let i = 0; i < prepared.length - 1; i += 1) {
      const a = prepared[i];
      const b = prepared[i + 1];
      if (a.targetTemperature == null || b.targetTemperature == null) continue;

      const deltaA = a.targetTemperature - a.currentTemperature;
      const deltaB = b.targetTemperature - b.currentTemperature;

      const x1 = xScale(a.date);
      const x2 = xScale(b.date);
      const yc1 = yScale(a.currentTemperature);
      const yc2 = yScale(b.currentTemperature);
      const yt1 = yScale(a.targetTemperature);
      const yt2 = yScale(b.targetTemperature);

      const sameDirection = deltaA === 0 || deltaB === 0 || Math.sign(deltaA) === Math.sign(deltaB);

      if (sameDirection) {
        bands.push({
          id: `${a.date.toISOString()}-${b.date.toISOString()}-single`,
          points: `${x1},${yc1} ${x1},${yt1} ${x2},${yt2} ${x2},${yc2}`,
          color: bandColor(deltaA, deltaB),
        });
        continue;
      }

      const ratioRaw = deltaA / (deltaA - deltaB);
      const ratio = Math.max(0, Math.min(1, ratioRaw));
      const xMid = x1 + (x2 - x1) * ratio;
      const yCurrentMid = yc1 + (yc2 - yc1) * ratio;
      const yTargetMid = yt1 + (yt2 - yt1) * ratio;
      const yMid = (yCurrentMid + yTargetMid) / 2;

      bands.push({
        id: `${a.date.toISOString()}-${b.date.toISOString()}-a`,
        points: `${x1},${yc1} ${x1},${yt1} ${xMid},${yMid}`,
        color: bandColor(deltaA, 0),
      });

      bands.push({
        id: `${a.date.toISOString()}-${b.date.toISOString()}-b`,
        points: `${xMid},${yMid} ${x2},${yt2} ${x2},${yc2}`,
        color: bandColor(0, deltaB),
      });
    }

    return bands;
  }, [prepared, xScale, yScale]);

  const hoverAnchor = useMemo(() => {
    if (!hoverDate) return null;
    return findNearestDate(prepared, hoverDate) as TemperaturePoint | null;
  }, [hoverDate, prepared]);

  const ticksX = (timeHour.every(2) ? xScale.ticks(timeHour.every(2)!) : xScale.ticks(6)).slice(-12);
  const ticksY = yScale.ticks(4);

  const handlePointer = (evt: PointerEvent<SVGRectElement>) => {
    if (!prepared.length) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const dateAtCursor = xScale.invert(Math.max(0, Math.min(innerWidth, x)));
    const nearest = findNearestDate(prepared, dateAtCursor);
    if (nearest) setHoverDate(nearest.date);
  };

  return (
    <div ref={containerRef} data-chart-id={id} className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{title}</p>
          <p className="text-lg font-semibold text-slate-900">
            {hoverAnchor ? formatDateTime(hoverAnchor.date) : prepared[prepared.length - 1] ? formatDateTime(prepared[prepared.length - 1].date) : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-orange-700">
            <span className="h-2 w-2 rounded-full bg-orange-500" /> Target above current
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-sky-700">
            <span className="h-2 w-2 rounded-full bg-sky-500" /> Target below current
          </span>
        </div>
      </div>

      {!prepared.length ? (
        <ChartEmpty label={emptyLabel} />
      ) : (
        <svg width={measuredWidth} height={height} className="overflow-visible">
          <g transform={`translate(${chartPadding.left},${chartPadding.top})`}>
            {ticksY.map((t) => (
              <line
                key={`y-${t}`}
                x1={0}
                x2={innerWidth}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="#e2e8f0"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            ))}

            {areaBands.map((band) => (
              <polygon key={band.id} points={band.points} fill={band.color} fillOpacity={0.22} />
            ))}

            {targetPath && (
              <path
                d={targetPath}
                fill="none"
                stroke="#0f172a"
                strokeWidth={2}
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.8}
              />
            )}

            {currentPath && (
              <path
                d={currentPath}
                fill="none"
                stroke="#334155"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {hoverAnchor && (
              <>
                <line
                  x1={xScale(hoverAnchor.date)}
                  x2={xScale(hoverAnchor.date)}
                  y1={0}
                  y2={innerHeight}
                  stroke="#94a3b8"
                  strokeDasharray="3 3"
                  strokeOpacity={0.55}
                />
                <circle
                  cx={xScale(hoverAnchor.date)}
                  cy={yScale(hoverAnchor.currentTemperature)}
                  r={5}
                  fill="white"
                  stroke="#334155"
                  strokeWidth={2}
                />
                {hoverAnchor.targetTemperature != null && (
                  <circle
                    cx={xScale(hoverAnchor.date)}
                    cy={yScale(hoverAnchor.targetTemperature)}
                    r={5}
                    fill="white"
                    stroke="#0f172a"
                    strokeWidth={2}
                  />
                )}
                <foreignObject
                  x={Math.max(0, xScale(hoverAnchor.date) - 95)}
                  y={6}
                  width={210}
                  height={90}
                >
                  <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-700 shadow-sm">
                    <div className="font-semibold text-slate-900">Current: {formatTemp(hoverAnchor.currentTemperature)}</div>
                    <div>
                      Target:{' '}
                      {hoverAnchor.targetTemperature == null ? 'Unknown' : formatTemp(hoverAnchor.targetTemperature)}
                    </div>
                    <div className="text-slate-500">
                      {hoverAnchor.targetTemperature == null
                        ? 'Heating state unknown'
                        : hoverAnchor.targetTemperature > hoverAnchor.currentTemperature
                        ? 'Heating ON'
                        : 'Heating OFF'}
                    </div>
                  </div>
                </foreignObject>
              </>
            )}

            {ticksX.map((tick, idx) => (
              <g key={`x-${idx}`} transform={`translate(${xScale(tick)},${innerHeight})`}>
                <line y2={6} stroke="#cbd5e1" />
                <text dy="1.3em" textAnchor="middle" className="text-[11px] fill-slate-500">
                  {formatDateTime(tick)}
                </text>
              </g>
            ))}

            {ticksY.map((t) => (
              <g key={`y-label-${t}`} transform={`translate(0,${yScale(t)})`}>
                <text x={-12} dy="0.32em" textAnchor="end" className="text-[11px] fill-slate-500">
                  {t.toFixed(1)}
                </text>
              </g>
            ))}

            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onPointerMove={handlePointer}
              onPointerLeave={() => setHoverDate(null)}
            />
          </g>
        </svg>
      )}
    </div>
  );
}

export function BoilerHeatingStateChart({
  id,
  title,
  series,
  height = 320,
  forcedWidth,
  emptyLabel,
}: {
  id: string;
  title: string;
  series: HeatingStateSeries[];
  height?: number;
  forcedWidth?: number;
  emptyLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!containerRef.current || forcedWidth) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [forcedWidth]);

  const orderedSeries = useMemo(
    () =>
      series
        .map((entry) => ({
          ...entry,
          points: entry.points.slice().sort((a, b) => a.date.getTime() - b.date.getTime()),
        }))
        .filter((entry) => entry.points.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [series]
  );

  const allDates = useMemo(() => {
    const values = new Set<number>();
    for (const entry of orderedSeries) {
      for (const point of entry.points) {
        values.add(point.date.getTime());
      }
    }
    return Array.from(values)
      .sort((a, b) => a - b)
      .map((ms) => new Date(ms));
  }, [orderedSeries]);

  const xDomain = extent(allDates, (d) => d);
  const measuredWidth = forcedWidth || width || 640;
  const innerWidth = Math.max(140, measuredWidth - chartPadding.left - chartPadding.right);
  const innerHeight = Math.max(160, height - chartPadding.top - chartPadding.bottom);

  const xScale = scaleTime().domain((xDomain as [Date, Date]) || [new Date(), new Date()]).range([0, innerWidth]);
  const yScale = scaleLinear().domain([-0.1, 1.1]).range([innerHeight, 0]);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    orderedSeries.forEach((entry, idx) => {
      map.set(entry.id, entry.color || palette[idx % palette.length]);
    });
    return map;
  }, [orderedSeries]);

  const activeRows = useMemo(() => {
    if (!hoverDate) return [];
    return orderedSeries.map((entry) => {
      const nearest = findNearestDate(entry.points, hoverDate) as HeatingStatePoint | null;
      return {
        id: entry.id,
        label: entry.label,
        state: nearest?.state ?? null,
        color: colorMap.get(entry.id) || palette[0],
      };
    });
  }, [hoverDate, orderedSeries, colorMap]);

  const handlePointer = (evt: PointerEvent<SVGRectElement>) => {
    if (!allDates.length) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const dateAtCursor = xScale.invert(Math.max(0, Math.min(innerWidth, x)));
    const nearest = findNearestDate(allDates.map((date) => ({ date })), dateAtCursor);
    if (nearest) setHoverDate(nearest.date);
  };

  const ticksX = (timeHour.every(2) ? xScale.ticks(timeHour.every(2)!) : xScale.ticks(6)).slice(-12);

  if (orderedSeries.length === 0 || allDates.length === 0) {
    return (
      <div ref={containerRef} className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{title}</p>
        </div>
        <ChartEmpty label={emptyLabel} />
      </div>
    );
  }

  return (
    <div ref={containerRef} data-chart-id={id} className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{title}</p>
          <p className="text-lg font-semibold text-slate-900">
            {hoverDate ? formatDateTime(hoverDate) : formatDateTime(allDates[allDates.length - 1])}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          {orderedSeries.slice(0, 6).map((entry) => (
            <span key={entry.id} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorMap.get(entry.id) }} />
              {entry.label}
            </span>
          ))}
          {orderedSeries.length > 6 && <span className="rounded-full bg-slate-100 px-2 py-1">+{orderedSeries.length - 6} more</span>}
        </div>
      </div>

      <svg width={measuredWidth} height={height} className="overflow-visible">
        <g transform={`translate(${chartPadding.left},${chartPadding.top})`}>
          <line x1={0} x2={innerWidth} y1={yScale(1)} y2={yScale(1)} stroke="#e2e8f0" strokeDasharray="4 4" />
          <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} stroke="#e2e8f0" strokeDasharray="4 4" />

          {orderedSeries.map((entry) => {
            const color = colorMap.get(entry.id) || palette[0];
            const path =
              line<HeatingStatePoint>()
                .defined((d) => d.state !== null)
                .x((d) => xScale(d.date))
                .y((d) => yScale(d.state ?? 0))
                .curve(curveStepAfter)(entry.points) ?? '';
            return <path key={entry.id} d={path} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" opacity={0.95} />;
          })}

          {hoverDate && (
            <line
              x1={xScale(hoverDate)}
              x2={xScale(hoverDate)}
              y1={0}
              y2={innerHeight}
              stroke="#94a3b8"
              strokeDasharray="3 3"
              strokeOpacity={0.55}
            />
          )}

          {ticksX.map((tick, idx) => (
            <g key={`x-${idx}`} transform={`translate(${xScale(tick)},${innerHeight})`}>
              <line y2={6} stroke="#cbd5e1" />
              <text dy="1.3em" textAnchor="middle" className="text-[11px] fill-slate-500">
                {formatDateTime(tick)}
              </text>
            </g>
          ))}

          <g transform={`translate(0,${yScale(1)})`}>
            <text x={-12} dy="0.32em" textAnchor="end" className="text-[11px] fill-slate-500">
              ON
            </text>
          </g>
          <g transform={`translate(0,${yScale(0)})`}>
            <text x={-12} dy="0.32em" textAnchor="end" className="text-[11px] fill-slate-500">
              OFF
            </text>
          </g>

          {hoverDate && activeRows.length > 0 && (
            <foreignObject x={Math.max(0, xScale(hoverDate) - 100)} y={4} width={220} height={Math.min(320, 44 + activeRows.length * 22)}>
              <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-700 shadow-sm">
                {activeRows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 py-1">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="font-semibold text-slate-900">
                      {row.state == null ? 'Unknown' : row.state > 0 ? 'ON' : 'OFF'}
                    </span>
                  </div>
                ))}
              </div>
            </foreignObject>
          )}

          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={handlePointer}
            onPointerLeave={() => setHoverDate(null)}
          />
        </g>
      </svg>
    </div>
  );
}
