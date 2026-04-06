import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MAX_DAYS = 365;
const UNASSIGNED = 'Unassigned';

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

function bucket2hUtc(date: Date) {
  const hour = date.getUTCHours();
  const bucketHour = Math.floor(hour / 2) * 2;
  const bucketStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), bucketHour, 0, 0, 0));
  const label = `${bucketStart.getUTCFullYear()}-${String(bucketStart.getUTCMonth() + 1).padStart(2, '0')}-${String(
    bucketStart.getUTCDate()
  ).padStart(2, '0')} ${String(bucketHour).padStart(2, '0')}:00`;
  return { key: bucketStart.toISOString(), bucketStart, label };
}

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
  const rawDays = searchParams.get('days');
  const isAllTime = rawDays === 'all';
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');
  const daysParsed = Number.parseInt(rawDays || '', 10);
  const days = Number.isFinite(daysParsed) && daysParsed > 0 ? Math.min(daysParsed, MAX_DAYS) : 90;

  const selectedEntityIds = parseMulti(searchParams, 'entityIds');
  const areasFilter = new Set(parseMulti(searchParams, 'areas'));

  if (selectedEntityIds.length === 0) {
    return NextResponse.json({ ok: true, unit: '°C', points: [] });
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
      where: { haConnectionId },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true },
    });
    const nowEnd = endOfDayUtc(new Date());
    from = oldest ? startOfDayUtc(oldest.capturedAt) : nowEnd;
    to = nowEnd;
  }

  let allowedEntityIds = new Set(selectedEntityIds);
  if (areasFilter.size > 0) {
    const [haDevices, overrides] = await Promise.all([
      getDevicesForHaConnection(haConnectionId, { cacheTtlMs: 2000 }).catch(() => []),
      prisma.device.findMany({
        where: { haConnectionId },
        select: { entityId: true, name: true, area: true },
      }),
    ]);

    const haMap = new Map(
      haDevices.map((d) => [d.entityId, { name: d.name ?? '', area: d.area ?? d.areaName ?? null }])
    );
    const overrideMap = new Map(overrides.map((d) => [d.entityId, d]));

    const resolveArea = (entityId: string) => {
      const ha = haMap.get(entityId);
      const override = overrideMap.get(entityId);
      return (override?.area ?? ha?.area ?? '').trim() || null;
    };

    const matchesArea = (area: string | null) => {
      const normalized = (area ?? '').trim();
      if (!normalized) return areasFilter.has(UNASSIGNED);
      return areasFilter.has(normalized);
    };

    allowedEntityIds = new Set(
      selectedEntityIds.filter((id) => matchesArea(resolveArea(id)))
    );
  }

  if (allowedEntityIds.size === 0) {
    return NextResponse.json({ ok: true, unit: '°C', points: [] });
  }

  const readings = await prisma.boilerTemperatureReading.findMany({
    where: {
      haConnectionId,
      entityId: { in: Array.from(allowedEntityIds) },
      capturedAt: { gte: from, lte: to },
    },
    orderBy: { capturedAt: 'asc' },
    select: { numericValue: true, capturedAt: true },
  });

  const buckets = new Map<string, { bucketStart: Date; label: string; sum: number; count: number }>();
  for (const reading of readings) {
    const info = bucket2hUtc(reading.capturedAt);
    const existing = buckets.get(info.key);
    if (!existing) {
      buckets.set(info.key, {
        bucketStart: info.bucketStart,
        label: info.label,
        sum: reading.numericValue,
        count: 1,
      });
    } else {
      existing.sum += reading.numericValue;
      existing.count += 1;
    }
  }

  const points = Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((b) => ({
      bucketStart: b.bucketStart.toISOString(),
      label: b.label,
      value: b.count > 0 ? b.sum / b.count : 0,
    }));

  return NextResponse.json({ ok: true, unit: '°C', points });
}
