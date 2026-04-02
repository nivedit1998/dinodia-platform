'use client';

import type { PointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleBand, scaleLinear, scaleTime } from 'd3-scale';
import { area, line, curveMonotoneX } from 'd3-shape';
import { bisector, extent, max } from 'd3-array';

export type TrendPoint = { date: Date; label: string; value: number };

export type LineAreaChartProps = {
  id: string;
  title: string;
  points: TrendPoint[];
  color: string;
  gradientFrom?: string;
  gradientTo?: string;
  height?: number;
  valueUnit?: string;
  emptyLabel?: string;
  formatValue?: (value: number) => string;
  variant?: 'line' | 'bar';
};

const defaultFormat = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
const chartPadding = { top: 24, right: 22, bottom: 32, left: 56 };

const ChartEmpty = ({ label }: { label?: string }) => (
  <div className="flex h-[280px] items-center justify-center rounded-2xl border border-slate-200/70 bg-white/80 text-sm text-slate-500">
    {label || 'No readings in this range.'}
  </div>
);

const getGradientStops = (color: string, from?: string, to?: string) => ({
  start: from || color,
  end: to || color,
});

export function LineAreaChart({
  id,
  title,
  points,
  color,
  gradientFrom,
  gradientTo,
  height = 320,
  valueUnit,
  emptyLabel,
  formatValue = defaultFormat,
  variant = 'line',
}: LineAreaChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const prepared = useMemo(() => points.filter((p) => Number.isFinite(p.value) && !Number.isNaN(p.value)), [points]);

  const xDomain = extent(prepared, (d) => d.date);
  const yMax = max(prepared, (d) => d.value) ?? 0;

  // Add gentle padding so the line sits off the edges.
  const yDomain: [number, number] = [0, yMax === 0 ? 1 : yMax * 1.08];

  const gradient = getGradientStops(color, gradientFrom, gradientTo);
  const measuredWidth = width || 640; // fallback while measuring to avoid zero-width render

  const innerWidth = Math.max(140, measuredWidth - chartPadding.left - chartPadding.right);
  const innerHeight = Math.max(140, height - chartPadding.top - chartPadding.bottom);

  const xScaleTime = scaleTime()
    .domain(xDomain as [Date, Date])
    .range([0, innerWidth]);
  const xScaleBand = scaleBand()
    .domain(prepared.map((p) => p.label))
    .range([0, innerWidth])
    .padding(0.2);

  const yScale = scaleLinear().domain(yDomain).range([innerHeight, 0]);

  const linePath =
    variant === 'line' && prepared.length
      ? line<TrendPoint>()
          .x((d) => xScaleTime(d.date))
          .y((d) => yScale(d.value))
          .curve(curveMonotoneX)(prepared)
      : null;

  const areaPath =
    variant === 'line' && prepared.length
      ? area<TrendPoint>()
          .x((d) => xScaleTime(d.date))
          .y0(innerHeight)
          .y1((d) => yScale(d.value))
          .curve(curveMonotoneX)(prepared)
      : null;

  const handlePointer = (evt: PointerEvent<SVGRectElement>) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const x = evt.clientX - rect.left - chartPadding.left;
    const dateAtCursor = xScaleTime.invert(Math.max(0, Math.min(innerWidth, x)));
    const b = bisector((d: TrendPoint) => d.date).center;
    const idx = b(prepared, dateAtCursor);
    setHoverIdx(Math.max(0, Math.min(prepared.length - 1, idx)));
  };

  const active = hoverIdx != null ? prepared[hoverIdx] : null;

  const ticksX =
    variant === 'line'
      ? xScaleTime.ticks(Math.min(6, Math.max(2, prepared.length)))
      : prepared.map((p) => p.date);
  const ticksY = yScale.ticks(4);

  const barWidth = xScaleBand.bandwidth();

  return (
    <div ref={containerRef} className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{title}</p>
          {active ? (
            <p className="text-lg font-semibold text-slate-900">
              {formatValue(active.value)} {valueUnit}{' '}
              <span className="text-sm font-normal text-slate-500">{active.label}</span>
            </p>
          ) : (
            <p className="text-lg font-semibold text-slate-900">
              {formatValue(prepared[prepared.length - 1]?.value ?? 0)} {valueUnit}
            </p>
          )}
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">Interactive · Hover to inspect</div>
      </div>

      {!prepared.length ? (
        <ChartEmpty label={emptyLabel} />
      ) : (
        <svg width={measuredWidth} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={gradient.start} stopOpacity={0.18} />
            <stop offset="100%" stopColor={gradient.end} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <g transform={`translate(${chartPadding.left},${chartPadding.top})`}>
          {/* Grid lines */}
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

          {/* Area + line or bars */}
          {variant === 'line' ? (
            <>
              {areaPath && <path d={areaPath} fill={`url(#${id}-area)`} />}
              {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
            </>
          ) : (
            prepared.map((p) => {
              const x = (xScaleBand(p.label) ?? 0) + barWidth / 2;
              const barHeight = innerHeight - yScale(p.value);
              return (
                <g key={p.label}>
                  <rect
                    x={x - barWidth / 2}
                    y={yScale(p.value)}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill={color}
                    fillOpacity={0.9}
                  />
                </g>
              );
            })
          )}

          {/* Active point/guide */}
          {active && (
            <g>
              <line
                x1={variant === 'line' ? xScaleTime(active.date) : (xScaleBand(active.label) ?? 0) + barWidth / 2}
                x2={variant === 'line' ? xScaleTime(active.date) : (xScaleBand(active.label) ?? 0) + barWidth / 2}
                y1={0}
                y2={innerHeight}
                stroke={color}
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
              <circle
                cx={variant === 'line' ? xScaleTime(active.date) : (xScaleBand(active.label) ?? 0) + barWidth / 2}
                cy={yScale(active.value)}
                r={6}
                fill="white"
                stroke={color}
                strokeWidth={2}
              />
              <foreignObject
                x={Math.max(0, (variant === 'line' ? xScaleTime(active.date) : (xScaleBand(active.label) ?? 0) + barWidth / 2) - 60)}
                y={Math.max(0, yScale(active.value) - 48)}
                width={140}
                height={60}
              >
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
                  <div className="font-semibold text-slate-900">
                    {formatValue(active.value)} {valueUnit}
                  </div>
                  <div className="text-slate-500">{active.label}</div>
                </div>
              </foreignObject>
            </g>
          )}

          {/* X axis */}
          {ticksX.map((t, idx) => {
            const isLine = variant === 'line';
            const xPos = isLine ? xScaleTime(t as Date) : (xScaleBand(prepared[idx]?.label) ?? 0) + barWidth / 2;
            const labelText = isLine
              ? (t as Date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
              : prepared[idx]?.label || (t as Date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
            return (
              <g key={`x-${idx}`} transform={`translate(${xPos},${innerHeight})`}>
                <line y2={6} stroke="#cbd5e1" />
                <text dy="1.3em" textAnchor="middle" className="text-[11px] fill-slate-500">
                  {labelText}
                </text>
              </g>
            );
          })}

          {/* Y axis */}
          {ticksY.map((t) => (
            <g key={`y-label-${t}`} transform={`translate(0,${yScale(t)})`}>
              <text x={-12} dy="0.32em" textAnchor="end" className="text-[11px] fill-slate-500">
                {formatValue(t)}
              </text>
            </g>
          ))}

          {/* Hover capture layer */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={handlePointer}
            onPointerLeave={() => setHoverIdx(null)}
          />
        </g>
        </svg>
      )}
    </div>
  );
}
