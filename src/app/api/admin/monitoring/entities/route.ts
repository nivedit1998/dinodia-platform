import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { prisma } from '@/lib/prisma';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 180;
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 4000;
const UNASSIGNED = 'Unassigned';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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
  const q = (searchParams.get('q') || '').trim();
  const limitRaw = Number.parseInt(searchParams.get('limit') || '', 10);
  const limit = clamp(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1, MAX_LIMIT);
  const daysRaw = Number.parseInt(searchParams.get('days') || '', 10);
  const days = clamp(Number.isFinite(daysRaw) ? daysRaw : DEFAULT_DAYS, 1, MAX_DAYS);
  const since = new Date(Date.now() - days * MS_PER_DAY);

  const whereBase = {
    haConnectionId,
    capturedAt: { gte: since },
    ...(q ? { entityId: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const energyEntities = await prisma.monitoringReading.findMany({
    where: {
      ...whereBase,
      unit: 'kWh',
    },
    distinct: ['entityId'],
    orderBy: [{ entityId: 'asc' }],
    take: limit,
    select: { entityId: true, capturedAt: true },
  });

  const batteryEntities = await prisma.monitoringReading.findMany({
    where: {
      ...whereBase,
      unit: '%',
      entityId: { contains: 'battery', mode: 'insensitive' },
    },
    distinct: ['entityId'],
    orderBy: [{ entityId: 'asc' }],
    take: limit,
    select: { entityId: true, capturedAt: true },
  });

  const allEntityIds = Array.from(new Set([...energyEntities, ...batteryEntities].map((e) => e.entityId)));
  const devices = await prisma.device.findMany({
    where: { haConnectionId, entityId: { in: allEntityIds } },
    select: { entityId: true, name: true, area: true },
  });
  const deviceById = new Map(devices.map((d) => [d.entityId, d]));

  const mapRow = (row: { entityId: string; capturedAt: Date }) => {
    const device = deviceById.get(row.entityId);
    const area = device?.area?.trim() || UNASSIGNED;
    const name = (device?.name || row.entityId || '').trim() || row.entityId;
    return {
      entityId: row.entityId,
      name,
      area,
      lastCapturedAt: row.capturedAt.toISOString(),
    };
  };

  return NextResponse.json({
    ok: true,
    energyEntities: energyEntities.map(mapRow),
    batteryEntities: batteryEntities.map(mapRow),
  });
}
