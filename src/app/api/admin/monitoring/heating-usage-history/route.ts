import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getGroupLabel } from '@/lib/deviceLabels';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MAX_DAYS = 365;

const startOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));

const endOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

const parseDateOnly = (value: string | null, endOfDay = false): Date | null => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map((v) => Number(v));
  const date = endOfDay ? endOfDayUtc(new Date(Date.UTC(y, m - 1, d))) : startOfDayUtc(new Date(Date.UTC(y, m - 1, d)));
  return Number.isNaN(date.getTime()) ? null : date;
};

function parseMulti(searchParams: URLSearchParams, key: string): string[] {
  const direct = searchParams.getAll(key);
  const bracketed = searchParams.getAll(`${key}[]`);
  const combined = [...direct, ...bracketed]
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(combined));
}

function normalizeHeatingLabel(value: string | null) {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'boiler') return 'Boiler';
  if (normalized === 'radiator') return 'Radiator';
  return null;
}

const prettyEntityId = (id: string) => id.replace(/^[^.]+\./i, '').replace(/_/g, ' ');

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  let haConnectionId: number;
  try {
    const { haConnection } = await getUserWithHaConnection(me.id);
    haConnectionId = haConnection.id;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection is missing for this home.' },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const requestedLabel = normalizeHeatingLabel(searchParams.get('label'));
  const rawDays = searchParams.get('days');
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');
  const isAllTime = rawDays === 'all';
  const daysParsed = Number.parseInt(rawDays || '', 10);
  const days = Number.isFinite(daysParsed) && daysParsed > 0 ? Math.min(daysParsed, MAX_DAYS) : 30;

  const selectedEntityIds = parseMulti(searchParams, 'entityIds');
  if (selectedEntityIds.length === 0) {
    return NextResponse.json({ ok: true, unit: 'min', seriesByEntity: [], meta: { label: requestedLabel } });
  }

  let from = startOfDayUtc(new Date(Date.now() - (days - 1) * MS_PER_DAY));
  let to = endOfDayUtc(new Date());

  if (rawFrom || rawTo) {
    const parsedFrom = parseDateOnly(rawFrom, false);
    const parsedTo = parseDateOnly(rawTo, true);
    if (!parsedFrom || !parsedTo) {
      return NextResponse.json({ error: 'Invalid from/to date. Use YYYY-MM-DD.' }, { status: 400 });
    }
    if (parsedTo.getTime() < parsedFrom.getTime()) {
      return NextResponse.json({ error: 'from must be on or before to.' }, { status: 400 });
    }
    const spanDays = Math.floor((endOfDayUtc(parsedTo).getTime() - startOfDayUtc(parsedFrom).getTime()) / MS_PER_DAY) + 1;
    if (spanDays > MAX_DAYS && !isAllTime) {
      return NextResponse.json({ error: `Date range too large. Max ${MAX_DAYS} days.` }, { status: 400 });
    }
    from = startOfDayUtc(parsedFrom);
    to = endOfDayUtc(parsedTo);
  }

  if (isAllTime) {
    const oldest = await prisma.boilerTemperatureReading.findFirst({
      where: { haConnectionId, entityId: { in: selectedEntityIds } },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true },
    });
    const nowEnd = endOfDayUtc(new Date());
    from = oldest ? startOfDayUtc(oldest.capturedAt) : nowEnd;
    to = nowEnd;
  }

  const [haDevices, overrides] = await Promise.all([
    getDevicesForHaConnection(haConnectionId, { cacheTtlMs: 2000 }).catch(() => []),
    prisma.device.findMany({
      where: { haConnectionId },
      select: { entityId: true, name: true, area: true, label: true },
    }),
  ]);

  const haMap = new Map(
    haDevices.map((d) => [d.entityId, { name: d.name ?? '', area: d.area ?? d.areaName ?? null, label: getGroupLabel(d) }])
  );
  const overrideMap = new Map(overrides.map((d) => [d.entityId, d]));

  const resolveArea = (entityId: string) => {
    const ha = haMap.get(entityId);
    const override = overrideMap.get(entityId);
    return (override?.area ?? ha?.area ?? '').trim() || null;
  };

  const resolveName = (entityId: string) => {
    const ha = haMap.get(entityId);
    const override = overrideMap.get(entityId);
    const name = (override?.name ?? ha?.name ?? '').trim();
    return name || prettyEntityId(entityId);
  };

  const resolveLabel = (entityId: string) => {
    const ha = haMap.get(entityId);
    const override = overrideMap.get(entityId);
    const overrideLabel = (override?.label ?? '').trim();
    if (overrideLabel) return overrideLabel;
    return ha?.label ?? null;
  };

  const allowedEntityIds = requestedLabel
    ? selectedEntityIds.filter((id) => (resolveLabel(id) || '').toLowerCase() === requestedLabel.toLowerCase())
    : selectedEntityIds;

  if (allowedEntityIds.length === 0) {
    return NextResponse.json({ ok: true, unit: 'min', seriesByEntity: [], meta: { label: requestedLabel } });
  }

  const readings = await prisma.boilerTemperatureReading.findMany({
    where: {
      haConnectionId,
      entityId: { in: allowedEntityIds },
      capturedAt: { gte: from, lte: to },
    },
    orderBy: { capturedAt: 'asc' },
    select: {
      entityId: true,
      capturedAt: true,
      onForSeconds: true,
      offForSeconds: true,
      unknownForSeconds: true,
    },
  });

  const pointsByEntity = new Map<
    string,
    Array<{ ts: string; onMinutes: number | null; offMinutes: number | null; unknownMinutes: number | null }>
  >();

  for (const row of readings) {
    const list = pointsByEntity.get(row.entityId) ?? [];
    list.push({
      ts: row.capturedAt.toISOString(),
      onMinutes: typeof row.onForSeconds === 'number' ? row.onForSeconds / 60 : null,
      offMinutes: typeof row.offForSeconds === 'number' ? row.offForSeconds / 60 : null,
      unknownMinutes: typeof row.unknownForSeconds === 'number' ? row.unknownForSeconds / 60 : null,
    });
    pointsByEntity.set(row.entityId, list);
  }

  const seriesByEntity = allowedEntityIds
    .map((entityId) => ({
      entityId,
      name: resolveName(entityId),
      area: resolveArea(entityId),
      label: resolveLabel(entityId),
      points: pointsByEntity.get(entityId) ?? [],
    }))
    .filter((s) => s.points.length > 0);

  return NextResponse.json({
    ok: true,
    unit: 'min',
    seriesByEntity,
    meta: {
      label: requestedLabel,
      from: from.toISOString(),
      to: to.toISOString(),
    },
  });
}
