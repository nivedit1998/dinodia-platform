import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  let homeId: number;
  let haConnectionId: number;
  try {
    const { user, haConnection } = await getUserWithHaConnection(me.id);
    homeId = user.homeId!;
    haConnectionId = haConnection.id;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection is missing for this home.' },
      { status: 400 }
    );
  }

  const accessAreas = await prisma.accessRule.findMany({
    where: { user: { homeId } },
    select: { area: true },
  });

  const deviceAreas = await prisma.device.findMany({
    where: { haConnectionId },
    select: { area: true },
  });

  const areas = new Set<string>();
  [...accessAreas, ...deviceAreas].forEach((entry) => {
    const val = (entry.area ?? '').trim();
    if (val) areas.add(val);
  });

  return NextResponse.json({
    ok: true,
    areas: Array.from(areas).sort((a, b) => a.localeCompare(b)),
  });
}
