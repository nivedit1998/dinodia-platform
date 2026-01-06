import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';
import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';
import { aggregateMonitoringHistory } from '@/lib/monitoringHistory';

export const runtime = 'nodejs';

function computeKwhTotal(readings: { numericValue: number | null; unit?: string | null; capturedAt: Date }[], entityId: string) {
  const { points } = aggregateMonitoringHistory({
    readings,
    baseline: null,
    bucket: 'daily',
    omitFirstIfNoBaseline: true,
    entityId,
  });
  if (!points.length) return 0;
  return points.reduce((sum, p) => sum + (Number.isFinite(p.value) ? p.value : 0), 0);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  if (user.role !== Role.ADMIN) {
    return NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 });
  }

  try {
    await requireTrustedAdminDevice(req, user.id);
  } catch (err) {
    const resp = toTrustedDeviceResponse(err);
    if (resp) return resp;
    throw err;
  }

  const body = await req.json().catch(() => null);
  const rawIds: unknown[] = Array.isArray(body?.entityIds) ? body.entityIds : [];
  const entityIds = rawIds
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());

  if (entityIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'Provide entityIds as a non-empty array.' }, { status: 400 });
  }

  const uniqueIds = Array.from(new Set(entityIds));
  const { haConnection } = await getUserWithHaConnection(user.id);

  const rows = await prisma.monitoringReading.findMany({
    where: {
      haConnectionId: haConnection.id,
      entityId: { in: uniqueIds },
      unit: 'kWh',
    },
    orderBy: [{ entityId: 'asc' }, { capturedAt: 'asc' }],
  });

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!grouped.has(row.entityId)) grouped.set(row.entityId, []);
    grouped.get(row.entityId)!.push(row as (typeof rows)[number]);
  }

  const totals = uniqueIds.map((entityId) => {
    const list = grouped.get(entityId) ?? [];
    const readings = list
      .map((r) => {
        const numeric = typeof r.numericValue === 'number' ? r.numericValue : Number(r.state);
        return {
          numericValue: Number.isFinite(numeric) ? numeric : null,
          unit: r.unit,
          capturedAt: r.capturedAt,
        };
      })
      .filter((r) => r.numericValue !== null);

    const total = readings.length >= 1 ? computeKwhTotal(readings, entityId) : 0;
    return { entityId, totalKwh: total };
  });

  return NextResponse.json({ ok: true, totals });
}
