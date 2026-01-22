import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const homes = await prisma.home.findMany({
    select: {
      id: true,
      createdAt: true,
      hubInstall: {
        select: {
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const data = homes.map((home) => {
    const installedAt = home.hubInstall?.createdAt ?? home.createdAt;
    return {
      homeId: home.id,
      installedAt,
    };
  });

  return NextResponse.json({ ok: true, homes: data });
}
