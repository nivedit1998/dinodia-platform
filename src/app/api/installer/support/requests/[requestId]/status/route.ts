import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';

type Status =
  | 'PENDING'
  | 'APPROVED'
  | 'CONSUMED'
  | 'EXPIRED'
  | 'NOT_FOUND';

function deriveStatus(challenge: { approvedAt: Date | null; consumedAt: Date | null; expiresAt: Date } | null): Status {
  if (!challenge) return 'NOT_FOUND';
  const now = new Date();
  if (challenge.expiresAt < now) return 'EXPIRED';
  if (challenge.consumedAt) return 'CONSUMED';
  if (challenge.approvedAt) return 'APPROVED';
  return 'PENDING';
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const { requestId } = await context.params;
  if (!requestId) {
    return NextResponse.json({ error: 'Missing request id.' }, { status: 400 });
  }

  const supportRequest = await prisma.supportRequest.findUnique({
    where: { id: requestId },
    select: { authChallengeId: true, installerUserId: true },
  });

  if (!supportRequest || supportRequest.installerUserId !== me.id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const challenge = await prisma.authChallenge.findUnique({
    where: { id: supportRequest.authChallengeId },
    select: { approvedAt: true, consumedAt: true, expiresAt: true },
  });

  const status = deriveStatus(challenge);

  return NextResponse.json({
    ok: true,
    status,
    expiresAt: challenge?.expiresAt ?? null,
  });
}
