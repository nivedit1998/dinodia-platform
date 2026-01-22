import { NextRequest, NextResponse } from 'next/server';
import { AuthChallengePurpose, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { buildSupportApprovalEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';

const TTL_MINUTES = 60;

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const homeId = Number(body?.homeId ?? 0);
  if (!Number.isInteger(homeId) || homeId <= 0) {
    return NextResponse.json({ error: 'Invalid home id.' }, { status: 400 });
  }

  const home = await prisma.home.findUnique({
    where: { id: homeId },
    select: {
      id: true,
      haConnection: { select: { ownerId: true } },
      users: {
        where: { role: Role.ADMIN },
        select: { id: true, email: true, username: true },
      },
    },
  });

  if (!home) {
    return NextResponse.json({ error: 'Home not found.' }, { status: 404 });
  }

  let targetUser:
    | { id: number; email: string; username: string | null }
    | null = null;

  if (home.haConnection?.ownerId) {
    const owner = await prisma.user.findUnique({
      where: { id: home.haConnection.ownerId },
      select: { id: true, email: true, username: true },
    });
    if (owner?.email) {
      targetUser = { id: owner.id, email: owner.email, username: owner.username };
    }
  }

  if (!targetUser) {
    const admin = home.users.find((u) => !!u.email);
    if (admin) {
      targetUser = { id: admin.id, email: admin.email!, username: admin.username };
    }
  }

  if (!targetUser) {
    return NextResponse.json(
      { error: 'No homeowner admin email found for this home.' },
      { status: 400 }
    );
  }

  const challenge = await createAuthChallenge({
    userId: targetUser.id,
    purpose: AuthChallengePurpose.SUPPORT_HOME_ACCESS,
    email: targetUser.email,
    ttlMinutes: TTL_MINUTES,
  });

  const supportRequest = await prisma.supportRequest.create({
    data: {
      kind: 'HOME_ACCESS',
      homeId,
      targetUserId: targetUser.id,
      installerUserId: me.id,
      authChallengeId: challenge.id,
    },
  });

  const appUrl = getAppUrl();
  const verifyUrl = buildVerifyUrl(challenge.token);
  const email = buildSupportApprovalEmail({
    kind: 'SUPPORT_HOME_ACCESS',
    verifyUrl,
    appUrl,
    installerUsername: me.username,
    homeId,
    targetUsername: targetUser.username ?? undefined,
  });

  await sendEmail({
    to: targetUser.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  return NextResponse.json({
    ok: true,
    requestId: supportRequest.id,
    expiresAt: challenge.expiresAt,
  });
}
