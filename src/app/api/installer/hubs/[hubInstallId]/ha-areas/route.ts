import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import { listHaAreaNames } from '@/lib/haAreas';
import { resolveHaCloudFirst } from '@/lib/haConnection';
import { resolveHaLongLivedToken } from '@/lib/haSecrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ hubInstallId: string }> }) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return apiFailFromStatus(401, 'Installer access required.');
  }
  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return apiFailFromStatus(403, deviceError.message);
  }

  const { hubInstallId } = await context.params;
  const hub = await prisma.hubInstall.findUnique({
    where: { id: hubInstallId },
    select: {
      id: true,
      home: { select: { id: true, haConnection: true } },
    },
  });
  if (!hub?.home?.haConnection) {
    return apiFailFromStatus(404, 'Hub not found.');
  }

  const { longLivedToken } = resolveHaLongLivedToken(hub.home.haConnection);
  const hydrated = { ...hub.home.haConnection, longLivedToken };

  try {
    const areas = await listHaAreaNames(resolveHaCloudFirst(hydrated));
    return NextResponse.json({ ok: true, areas });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to load areas.';
    return apiFailFromStatus(400, message);
  }
}
