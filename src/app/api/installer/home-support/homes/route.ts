import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const deviceErr = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceErr instanceof Error) {
    return NextResponse.json({ error: deviceErr.message }, { status: 403 });
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
