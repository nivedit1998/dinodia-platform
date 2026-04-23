import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType } from '@prisma/client';
import { cookies } from 'next/headers';
import { getJwtClaimsFromRequest, setAuthCookie } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const BACKUP_COOKIE_NAME = 'dinodia_installer_backup_token';

export async function GET(req: NextRequest) {
  const claims = await getJwtClaimsFromRequest(req);
  const impersonation = claims?.impersonation;

  const cookieStore = await cookies();
  const backup = cookieStore.get(BACKUP_COOKIE_NAME)?.value ?? null;

  if (impersonation?.supportRequestId && Number.isInteger(impersonation.installerUserId)) {
    const supportRequest = await prisma.supportRequest.findUnique({
      where: { id: impersonation.supportRequestId },
      select: {
        id: true,
        homeId: true,
        installerUserId: true,
        targetUserId: true,
        scope: true,
        reason: true,
      },
    });

    if (supportRequest && supportRequest.installerUserId === impersonation.installerUserId) {
      await prisma.auditEvent.create({
        data: {
          type: AuditEventType.SUPPORT_IMPERSONATION_STOPPED,
          homeId: supportRequest.homeId,
          actorUserId: impersonation.installerUserId,
          metadata: {
            supportRequestId: supportRequest.id,
            targetUserId: supportRequest.targetUserId,
            scope: supportRequest.scope,
            reason: supportRequest.reason,
            restoredInstallerSession: Boolean(backup),
          },
        },
      });
    }
  }

  if (!backup) {
    return NextResponse.json({ ok: true, restored: false });
  }

  await setAuthCookie(backup);
  cookieStore.set(BACKUP_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return NextResponse.json({ ok: true, restored: true });
}
