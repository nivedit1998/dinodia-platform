import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { prisma } from '@/lib/prisma';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_LOOKBACK_DAYS = 180;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
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
  const q = (searchParams.get('q') || '').trim();
  const limitRaw = Number.parseInt(searchParams.get('limit') || '', 10);
  const limit = clamp(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1, MAX_LIMIT);

  const daysRaw = Number.parseInt(searchParams.get('days') || '', 10);
  const lookbackDays = clamp(Number.isFinite(daysRaw) ? daysRaw : DEFAULT_LOOKBACK_DAYS, 1, MAX_LOOKBACK_DAYS);
  const fromDate = new Date(Date.now() - lookbackDays * MS_PER_DAY);

  const deviceWhere = {
    haConnectionId,
    ...(q
      ? {
          OR: [
            { entityId: { contains: q, mode: 'insensitive' as const } },
            { name: { contains: q, mode: 'insensitive' as const } },
            { area: { contains: q, mode: 'insensitive' as const } },
            { label: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const devices = await prisma.device.findMany({
    where: deviceWhere,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: { entityId: true, name: true, label: true, area: true, blindTravelSeconds: true, updatedAt: true, id: true },
  });

  const observedRows = await prisma.monitoringReading.findMany({
    where: {
      haConnectionId,
      capturedAt: { gte: fromDate },
      OR: [
        { unit: 'kWh' },
        { unit: '%', entityId: { contains: 'battery', mode: 'insensitive' as const } },
      ],
      ...(q ? { entityId: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    orderBy: [{ entityId: 'asc' }, { capturedAt: 'desc' }],
    select: { entityId: true, unit: true, capturedAt: true },
  });

  const observedByEntity = new Map<string, { entityId: string; unit: string | null; capturedAt: Date }>();
  for (const row of observedRows) {
    if (!observedByEntity.has(row.entityId)) {
      observedByEntity.set(row.entityId, {
        entityId: row.entityId,
        unit: row.unit ?? null,
        capturedAt: row.capturedAt,
      });
    }
  }

  const deviceSet = new Set(devices.map((d) => d.entityId));
  const prettyId = (id: string) => id.replace(/^sensor\./i, '').replace(/_/g, ' ');
  const deviceByEntity = new Map(devices.map((d) => [d.entityId, d]));
  const displayName = (entityId: string) => {
    const device = deviceByEntity.get(entityId);
    const primary = device?.name?.trim();
    const fallback = device?.label?.trim();
    return (primary || fallback || prettyId(entityId) || entityId).trim();
  };

  const observedEntities = Array.from(observedByEntity.values()).map((row) => ({
    entityId: row.entityId,
    name: displayName(row.entityId),
    unit: row.unit,
    lastCapturedAt: row.capturedAt.toISOString(),
    hasOverride: deviceSet.has(row.entityId),
  }));

  return NextResponse.json({
    ok: true,
    devices: devices.map((d) => ({
      ...d,
      name: displayName(d.entityId),
    })),
    observedEntities,
  });
}
